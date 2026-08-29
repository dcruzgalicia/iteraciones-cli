import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { validateDisabledFilters } from '../builder/filter-resolver.js';
import { listMarkdownDocuments } from '../builder/gitignore.js';
import { resolveEffectiveDisabledPreamble, validateDisabledPreambleFilters, validatePreambleDependencies } from '../builder/preamble-loader.js';
import {
  looseColonLines,
  looseColonsMessage,
  MISSING_TITLE_WARNING,
  validateConfigFilePaths,
  validateFrontmatterFields,
} from '../builder/project-validator.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError, translateSystemError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { logError, logInfo, logWarning, runWithWarningSink } from '../lib/logger.js';
import { plural } from '../lib/plural.js';

type ValidationError = { file: string; message: string };

type ValidationResult = {
  errors: ValidationError[];
  warnings: ValidationError[];
  /** Número de documentos Markdown validados. */
  count: number;
};

async function validateFrontmatter(cwd: string): Promise<ValidationResult> {
  // Descubrimiento compartido con discover y doctor (única fuente de exclusión)
  const entries = await listMarkdownDocuments(cwd);

  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const slugs = new Map<string, string>();
  for (const entry of entries) {
    const absPath = join(cwd, entry);
    let raw: string;
    try {
      raw = await readFile(absPath, 'utf8');
    } catch (err) {
      errors.push({
        file: entry,
        message: `no se pudo leer: ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`,
      });
      continue;
    }

    const { yaml, body } = splitFrontmatter(raw);
    // Líneas de ":" sueltas en el cuerpo: warning conservador, mismo contrato
    // que los checks de frontmatter (build y validate lo comparten via
    // project-validator). El offset suma las líneas del frontmatter para que el
    // número apunte al archivo completo (lo que ve el usuario en el editor).
    const lineOffset = raw.slice(0, raw.length - body.length).split('\n').length - 1;
    const looseColons = looseColonLines(body, lineOffset);
    if (looseColons.length > 0) {
      warnings.push({ file: entry, message: looseColonsMessage(looseColons) });
    }
    if (!yaml) {
      // Sin frontmatter (o frontmatter cerrado vacío: yaml === ''): un
      // documento sin contenido se omite con warning (mismo criterio que el
      // pipeline); un archivo que empieza con --- pero no cierra el bloque se
      // trata como cuerpo en silencio (la regex no matcheó) — el aviso lo hace
      // visible.
      if (!body.trim()) {
        warnings.push({
          file: entry,
          message: yaml === '' ? 'no tiene contenido después del frontmatter; se omite' : 'documento vacío; se omite',
        });
      } else if (/^---\r?\n/.test(raw)) {
        warnings.push({
          file: entry,
          message: 'frontmatter sin cerrar (falta el bloque "---" final); el contenido se tratará como cuerpo',
        });
      } else {
        // Documento con contenido y sin frontmatter: mismo warning que el build
        // (el pipeline usa "Sin título" como fallback).
        warnings.push({ file: entry, message: MISSING_TITLE_WARNING.message });
      }
      continue; // sin frontmatter → válido
    }

    // Validar la sintaxis YAML del frontmatter ANTES del warning de documento
    // sin cuerpo: un frontmatter inválido es un error aunque el documento no
    // tenga contenido (el error manda sobre el warning de omisión).
    let fmError = false;
    const yamlResult = parseYamlWithPosition(yaml);
    if (yamlResult.error) {
      fmError = true;
      errors.push({
        file: entry,
        message: `frontmatter YAML inválido: ${yamlResult.error}`,
      });
    } else {
      const result = yamlResult.value;
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        fmError = true;
        errors.push({
          file: entry,
          message: 'frontmatter YAML inválido: debe ser un objeto',
        });
      } else {
        const parsed = result as Record<string, unknown>;
        // Checks compartidos con el build (módulo project-validator): los
        // errores rompen ambos comandos con el mismo mensaje; los warnings se
        // muestran en ambos sin romper.
        for (const issue of validateFrontmatterFields(parsed)) {
          if (issue.severity === 'error') {
            fmError = true;
            errors.push({ file: entry, message: issue.message });
          } else {
            warnings.push({ file: entry, message: issue.message });
          }
        }
        // Slug manual duplicado: requiere estado entre documentos (los
        // duplicados sobrescribirían las salidas en dist/). En el build lo
        // cubre slug-resolver con todas las colisiones.
        const slug = typeof parsed.slug === 'string' ? parsed.slug.trim() : undefined;
        if (slug) {
          const outputKey = `${dirname(entry)}/${slug}`;
          const owner = slugs.get(outputKey);
          if (owner !== undefined) {
            fmError = true;
            errors.push({ file: entry, message: `slug duplicado: "${slug}" ya lo usa ${owner}` });
          } else {
            slugs.set(outputKey, entry);
          }
        }
        // Documento sin título (clave ausente o vacía): mismo warning que el
        // build (discover). Un title mal tipado no dispara este warning: es un
        // error de tipo ya reportado por validateFrontmatterFields.
        if (parsed.title === undefined || parsed.title === '') {
          warnings.push({ file: entry, message: MISSING_TITLE_WARNING.message });
        }
      }
    }
    // Frontmatter válido pero sin contenido: warning de omisión (no error).
    if (!body.trim() && !fmError) {
      warnings.push({
        file: entry,
        message: 'no tiene contenido después del frontmatter; se omite',
      });
    }
  }
  return { errors, warnings, count: entries.length };
}

export interface ValidationSummary {
  ok: boolean;
  documents: number;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Recolecta el resultado completo de la validación sin presentación: la
 * comparte el modo humano y el contrato --json (#2182).
 */
async function collectValidation(cwd: string): Promise<{ summary: ValidationSummary; disabledFiltersCount: number; luaFiltersCount: number }> {
  let disabledFiltersCount = 0;
  let luaFiltersCount = 0;
  const configErrors: ValidationError[] = [];
  const configWarnings: ValidationError[] = [];
  try {
    const config = await loadSiteConfig(cwd);
    disabledFiltersCount = config.disabledFilters?.length ?? 0;
    luaFiltersCount = config.luaFilters?.length ?? 0;
    // Validar nombres de filters desactivados. validateDisabledFilters emite
    // warnings vía logWarning que en modo humano se duplicarían (una vez por
    // stderr y otra en el bloque de allWarnings) y en JSON se perderían. Se
    // capturan temporalmente para paridad (#2234).
    const strayFilterWarnings: string[] = [];
    await runWithWarningSink(
      (msg) => strayFilterWarnings.push(msg),
      async () => {
        validateDisabledFilters(config.disabledFilters);
      },
    );
    for (const raw of strayFilterWarnings) {
      const message = raw.replace(/^[^\]]*\]\s*/, '');
      configWarnings.push({ file: 'config', message });
    }
    // Resolver dependencias implícitas (08-hyperref se desactiva con 99-pdfx)
    const effectiveDisabledPreamble = resolveEffectiveDisabledPreamble(config.format?.pdf?.disabledPreambleFilters);
    validateDisabledPreambleFilters(effectiveDisabledPreamble);
    // Dependencias entre preamble filters: errores y warnings semánticos
    for (const issue of validatePreambleDependencies(effectiveDisabledPreamble)) {
      if (issue.severity === 'error') {
        configErrors.push({ file: 'iteraciones.config.yaml', message: issue.message });
      } else {
        configWarnings.push({ file: 'iteraciones.config.yaml', message: issue.message });
      }
    }
    // Rutas configuradas (bibliography/csl/lua-filters): checks compartidos
    // con el build (módulo project-validator).
    for (const issue of await validateConfigFilePaths(cwd, config)) {
      if (issue.severity === 'error') {
        configErrors.push({ file: 'iteraciones.config.yaml', message: issue.message });
      } else {
        configWarnings.push({ file: 'iteraciones.config.yaml', message: issue.message });
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
  const { errors: fmErrors, warnings, count: docCount } = await validateFrontmatter(cwd);
  const errors = [...configErrors, ...fmErrors];
  const allWarnings = [...configWarnings, ...warnings];
  return {
    summary: { ok: errors.length === 0, documents: docCount, errors, warnings: allWarnings },
    disabledFiltersCount,
    luaFiltersCount,
  };
}

/**
 * Valida la configuración del proyecto y el frontmatter de los ficheros Markdown.
 * Comprueba: sintaxis YAML de la config con posición, tipos y campos conocidos
 * del frontmatter (título, subtítulo, fecha, autor, slug), frontmatter sin
 * cerrar, slugs manuales (formato y duplicados), dependencias entre preamble
 * filters y existencia de bibliografía/CSL/lua-filters. No ejecuta la
 * compilación completa. Con `--json`, stdout lleva un único objeto con el
 * mismo resultado estructurado (mismo contrato de errores que build, #2182).
 */
export async function validateProject(cwd: string, options: { json?: boolean } = {}): Promise<void> {
  const { summary, disabledFiltersCount, luaFiltersCount } = await collectValidation(cwd);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (!summary.ok) process.exitCode = 1;
    return;
  }
  const { errors, warnings: allWarnings, documents: docCount, ok } = summary;

  if (allWarnings.length > 0) {
    logWarning(`${plural(allWarnings.length, 'advertencia')}:`, 'validate');
    for (const w of allWarnings) {
      logWarning(`${w.file}: ${w.message}`, 'validate');
    }
  }

  if (ok) {
    const detail: string[] = [plural(docCount, 'documento')];
    if (disabledFiltersCount > 0) detail.push(`${plural(disabledFiltersCount, 'filter', 'filters')} desactivados`);
    if (luaFiltersCount > 0) detail.push(`${plural(luaFiltersCount, 'lua-filter', 'lua-filters')}`);
    logInfo(`sin errores — ${detail.join(', ')}.`, 'validate');
    // Proyecto con config pero sin documentos: orientar al que está empezando
    // (init omite los archivos existentes, así que la sugerencia es segura).
    if (docCount === 0) {
      logInfo("si estás empezando, ejecuta 'iteraciones init' para crear el documento inicial", 'validate');
    }
    return;
  }

  logError(`${plural(errors.length, 'error')}:`, 'validate');
  for (const e of errors) {
    logError(`${e.file}: ${e.message}`, 'validate');
  }
  process.exitCode = 1;
}
