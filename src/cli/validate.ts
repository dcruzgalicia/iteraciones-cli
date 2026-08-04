import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { IGNORED_DIRS } from '../builder/discover.js';
import { validateDisabledPreambleFilters } from '../builder/preamble-loader.js';
import { validateDisabledFilters } from '../builder/render.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError } from '../lib/errors.js';
import { logInfo, logWarning } from '../lib/logger.js';
import { checkLatexEngine } from './doctor/system-checks.js';

type ValidationError = { file: string; message: string };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

// theme se pasa desde runValidate para evitar que loadSiteConfig se llame dos veces
// (una en validateConfig + otra aquí), lo que duplicaría los warnings de stderr.
type ValidationResult = {
  errors: ValidationError[];
  warnings: ValidationError[];
};

async function validateFrontmatter(cwd: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const entries: string[] = [];
  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    entries.push(entry);
  }
  // Ordenar para salida determinista independiente del sistema de archivos.
  entries.sort();

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
      }
    } catch (err) {
      errors.push({
        file: entry,
        message: `frontmatter YAML inválido: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { errors, warnings };
}

/**
 * Valida la configuración del proyecto y el frontmatter de los ficheros Markdown.
 * Incluye validación semántica: tipos, regiones, items de colecciones y templates.
 * No ejecuta la compilación completa.
 */
export async function runValidate(cwd: string): Promise<void> {
  let hasPdf = false;
  const configErrors: ValidationError[] = [];
  try {
    const config = await loadSiteConfig(cwd);
    hasPdf = !!config.format?.pdf;
    // Validar nombres de filters desactivados (warnings, no errores)
    validateDisabledFilters(config.disabledFilters);
    validateDisabledPreambleFilters(config.disabledPreambleFilters);
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
        message: 'format.pdf requiere pdflatex pero no esta disponible — ' + (latexResult.detail ?? ''),
      });
    }
  }
  const { errors: fmErrors, warnings } = await validateFrontmatter(cwd);
  const errors = [...configErrors, ...fmErrors];

  if (warnings.length > 0) {
    logWarning(`${warnings.length} advertencia(s):`, 'validate');
    for (const w of warnings) {
      logWarning(`${w.file}: ${w.message}`, 'validate');
    }
  }

  if (errors.length === 0) {
    logInfo('sin errores.', 'validate');
    return;
  }

  logWarning(`se encontraron ${errors.length} error(es):`, 'validate');
  for (const e of errors) {
    logWarning(`${e.file}: ${e.message}`, 'validate');
  }
  process.exitCode = 1;
}
