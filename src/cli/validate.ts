import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { IGNORED_DIRS } from '../builder/discover.js';
import { isHiddenPath, isIgnoredByRules, loadGitignoreRules } from '../builder/gitignore.js';
import { validateDisabledPreambleFilters } from '../builder/preamble-loader.js';
import { validateDisabledFilters } from '../builder/render.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError } from '../lib/errors.js';
import { logError, logInfo, logWarning } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { checkLatexEngine } from './doctor/system-checks.js';

type ValidationError = { file: string; message: string };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Campos del frontmatter que el pipeline consume. Cualquier otro campo se
 * descarta en todos los formatos: validate advierte para que no sea silencioso.
 */
const KNOWN_FRONTMATTER_FIELDS = ['title', 'subtitle', 'date', 'author'];

/** Devuelve los campos del frontmatter que el pipeline ignorará. */
function unknownFrontmatterFields(parsed: Record<string, unknown>): string[] {
  return Object.keys(parsed).filter((key) => !KNOWN_FRONTMATTER_FIELDS.includes(key));
}

// theme se pasa desde runValidate para evitar que loadSiteConfig se llame dos veces
// (una en validateConfig + otra aquí), lo que duplicaría los warnings de stderr.
type ValidationResult = {
  errors: ValidationError[];
  warnings: ValidationError[];
  /** Número de documentos Markdown validados. */
  count: number;
};

async function validateFrontmatter(cwd: string): Promise<ValidationResult> {
  const entries: string[] = [];
  const gitignoreRules = await loadGitignoreRules(cwd);
  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    if (isIgnoredByRules(entry, gitignoreRules)) continue;
    if (isHiddenPath(entry)) continue;
    entries.push(entry);
  }
  // Ordenar para salida determinista independiente del sistema de archivos.
  entries.sort();

  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  for (const entry of entries) {
    const absPath = join(cwd, entry);
    let raw: string;
    try {
      raw = await readFile(absPath, 'utf8');
    } catch (err) {
      errors.push({
        file: entry,
        message: `no se pudo leer: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const match = FRONTMATTER_RE.exec(raw);
    if (!match) continue; // sin frontmatter → válido

    // Validar sintaxis YAML del frontmatter.
    try {
      const result = Bun.YAML.parse(match[1] ?? '');
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        errors.push({
          file: entry,
          message: 'frontmatter YAML inválido: debe ser un objeto',
        });
      } else {
        const unknown = unknownFrontmatterFields(result as Record<string, unknown>);
        if (unknown.length > 0) {
          warnings.push({
            file: entry,
            message: `campos de frontmatter ignorados por el pipeline: ${unknown.join(', ')}`,
          });
        }
      }
    } catch (err) {
      errors.push({
        file: entry,
        message: `frontmatter YAML inválido: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { errors, warnings, count: entries.length };
}

/**
 * Valida la configuración del proyecto y el frontmatter de los ficheros Markdown.
 * Incluye validación semántica: tipos, regiones, items de colecciones y templates.
 * No ejecuta la compilación completa.
 */
export async function runValidate(cwd: string): Promise<void> {
  let hasPdf = false;
  let disabledFiltersCount = 0;
  let luaFiltersCount = 0;
  const configErrors: ValidationError[] = [];
  const configWarnings: ValidationError[] = [];
  try {
    const config = await loadSiteConfig(cwd, { mode: 'validate' });
    // El transform del schema materializa siempre format.pdf con defaults, así
    // que su presencia no indica que el proyecto use PDF: el criterio real es
    // generate:true o LaTeX activo (mismo criterio que doctor).
    hasPdf = config.format?.pdf?.generate === true || config.format?.latex === true;
    disabledFiltersCount = config.disabledFilters?.length ?? 0;
    luaFiltersCount = config.luaFilters?.length ?? 0;
    // Validar nombres de filters desactivados (warnings, no errores)
    validateDisabledFilters(config.disabledFilters);
    validateDisabledPreambleFilters(config.format?.pdf?.disabledPreambleFilters);
    // Verificar que las rutas de lua-filters existan en el proyecto
    for (const rel of config.luaFilters ?? []) {
      if (!(await Bun.file(join(cwd, rel)).exists())) {
        configWarnings.push({ file: 'iteraciones.config.yaml', message: `lua-filters: "${rel}" no encontrado en el proyecto` });
      }
    }
    // Las rutas de bibliografía/CSL configuradas deben existir (error, no warning)
    for (const key of ['bibliography', 'csl'] as const) {
      const rel = config[key];
      if (!rel) continue;
      const abs = isAbsolute(rel) ? rel : join(cwd, rel);
      if (!(await Bun.file(abs).exists())) {
        configErrors.push({ file: 'iteraciones.config.yaml', message: `${key}: "${rel}" no encontrado en el proyecto` });
      }
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      configErrors.push({
        file: relative(cwd, err.configPath),
        message: err.message,
      });
    } else {
      configErrors.push({
        file: 'iteraciones.config.yaml',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Si format.pdf esta configurado, verificar que el motor LaTeX este disponible.
  if (hasPdf) {
    const latexResult = await checkLatexEngine();
    if (!latexResult.ok) {
      configErrors.push({
        file: 'iteraciones.config.yaml',
        message: `format.pdf requiere pdflatex pero no esta disponible — ${latexResult.detail ?? ''}`,
      });
    }
  }
  const { errors: fmErrors, warnings, count: docCount } = await validateFrontmatter(cwd);
  const errors = [...configErrors, ...fmErrors];
  const allWarnings = [...configWarnings, ...warnings];

  if (allWarnings.length > 0) {
    logWarning(`${plural(allWarnings.length, 'advertencia')}:`, 'validate');
    for (const w of allWarnings) {
      logWarning(`${w.file}: ${w.message}`, 'validate');
    }
  }

  if (errors.length === 0) {
    const detail: string[] = [plural(docCount, 'documento')];
    if (disabledFiltersCount > 0) detail.push(`${plural(disabledFiltersCount, 'filter', 'filters')} desactivados`);
    if (luaFiltersCount > 0) detail.push(`${plural(luaFiltersCount, 'lua-filter', 'lua-filters')}`);
    logInfo(`sin errores — ${detail.join(', ')}.`, 'validate');
    return;
  }

  logError(`${plural(errors.length, 'error')}:`, 'validate');
  for (const e of errors) {
    logError(`${e.file}: ${e.message}`, 'validate');
  }
  process.exitCode = 1;
}
