import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { validateDisabledFilters } from '../builder/filter-resolver.js';
import { listMarkdownDocuments } from '../builder/gitignore.js';
import { validateDisabledPreambleFilters, validatePreambleDependencies } from '../builder/preamble-loader.js';
import { validateConfigFilePaths, validateFrontmatterFields } from '../builder/project-validator.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { logError, logInfo, logWarning } from '../lib/logger.js';
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
        message: `no se pudo leer: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const { yaml } = splitFrontmatter(raw);
    if (!yaml) {
      // Un archivo que empieza con --- pero no cierra el bloque se trata como
      // cuerpo en silencio (la regex de splitFrontmatter no matchea): el aviso
      // hace visible el frontmatter malformado.
      if (/^---\r?\n/.test(raw)) {
        warnings.push({
          file: entry,
          message: 'frontmatter sin cerrar (falta el bloque "---" final); el contenido se tratará como cuerpo',
        });
      }
      continue; // sin frontmatter → válido
    }

    // Validar sintaxis YAML del frontmatter.
    const yamlResult = parseYamlWithPosition(yaml);
    if (yamlResult.error) {
      errors.push({
        file: entry,
        message: `frontmatter YAML inválido: ${yamlResult.error}`,
      });
    } else {
      const result = yamlResult.value;
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
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
            errors.push({ file: entry, message: `slug duplicado: "${slug}" ya lo usa ${owner}` });
          } else {
            slugs.set(outputKey, entry);
          }
        }
      }
    }
  }
  return { errors, warnings, count: entries.length };
}

/**
 * Valida la configuración del proyecto y el frontmatter de los ficheros Markdown.
 * Comprueba: sintaxis YAML de la config con posición, tipos y campos conocidos
 * del frontmatter (título, subtítulo, fecha, autor, slug), frontmatter sin
 * cerrar, slugs manuales (formato y duplicados), dependencias entre preamble
 * filters y existencia de bibliografía/CSL/lua-filters. No ejecuta la
 * compilación completa.
 */
export async function runValidate(cwd: string): Promise<void> {
  let disabledFiltersCount = 0;
  let luaFiltersCount = 0;
  const configErrors: ValidationError[] = [];
  const configWarnings: ValidationError[] = [];
  try {
    const config = await loadSiteConfig(cwd);
    disabledFiltersCount = config.disabledFilters?.length ?? 0;
    luaFiltersCount = config.luaFilters?.length ?? 0;
    // Validar nombres de filters desactivados (warnings, no errores)
    validateDisabledFilters(config.disabledFilters);
    validateDisabledPreambleFilters(config.format?.pdf?.disabledPreambleFilters);
    // Dependencias entre preamble filters: errores y warnings semánticos
    for (const issue of validatePreambleDependencies(config.format?.pdf?.disabledPreambleFilters)) {
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
