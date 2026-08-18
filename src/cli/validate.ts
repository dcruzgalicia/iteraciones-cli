import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { validateDisabledFilters } from '../builder/filter-resolver.js';
import { listMarkdownDocuments } from '../builder/gitignore.js';
import { validateDisabledPreambleFilters, validatePreambleDependencies } from '../builder/preamble-loader.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { logError, logInfo, logWarning } from '../lib/logger.js';
import { plural } from '../lib/plural.js';

type ValidationError = { file: string; message: string };

/**
 * Campos del frontmatter que el pipeline consume: los del pipeline
 * (title/subtitle/date/author/slug) y los que fluyen a pandoc o al template
 * efectivo con efecto visible (lang, toc, description, site-title, tagline,
 * theme, accent, css). Cualquier otro campo se descarta en todos los formatos:
 * validate advierte para que no sea silencioso.
 */
export const KNOWN_FRONTMATTER_FIELDS = [
  'title',
  'subtitle',
  'date',
  'author',
  'slug',
  'lang',
  'toc',
  'description',
  'site-title',
  'tagline',
  'theme',
  'accent',
  'css',
  // Páginas de título internas, colofón e imagen de portada (solo LaTeX;
  // HTML las ignora)
  'extratitle',
  'frontispiece',
  'titlehead',
  'subject',
  'dedication',
  'uppertitleback',
  'lowertitleback',
  'publishers',
  'colophon',
  'title-image',
  'publishers-image',
  'endpapers',
];

/** Formato seguro de un slug manual (mismo regex que discover). */
const SLUG_MANUAL_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Campos del frontmatter que el pipeline consume como texto (string). */
const STRING_FRONTMATTER_FIELDS = ['title', 'subtitle', 'date'];

/** Formato ISO documentado para date (mismo criterio que formatHumanDate). */
const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

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
        // Tipos de los campos conocidos: un tipo incorrecto es un error (el
        // pipeline lo degradaría o lo ignoraría en silencio, p. ej. title: 123
        // → "Sin título").
        for (const field of STRING_FRONTMATTER_FIELDS) {
          const value = parsed[field];
          if (value !== undefined && typeof value !== 'string') {
            errors.push({ file: entry, message: `frontmatter: "${field}" debe ser un texto (string), se recibió ${typeof value}` });
          }
        }
        const author = parsed.author;
        if (author !== undefined && typeof author !== 'string' && !(Array.isArray(author) && author.every((a) => typeof a === 'string'))) {
          errors.push({ file: entry, message: 'frontmatter: "author" debe ser un texto o una lista de textos' });
        }
        // date con formato libre: el pipeline la acepta deliberadamente
        // (formatHumanDate la deja pasar sin romper), pero el formato ISO es
        // el documentado: advertencia, no error.
        const date = parsed.date;
        if (typeof date === 'string' && date.trim() !== '' && !DATE_ISO_RE.test(date.trim())) {
          warnings.push({ file: entry, message: 'frontmatter: "date" no usa el formato ISO YYYY-MM-DD; se mostrará tal cual' });
        }
        const unknown = unknownFrontmatterFields(parsed);
        if (unknown.length > 0) {
          warnings.push({
            file: entry,
            message: `campos de frontmatter ignorados por el pipeline: ${unknown.join(', ')}`,
          });
        }
        // Slug manual: formato seguro y sin duplicados (los duplicados
        // sobrescribirían las salidas en dist/).
        const slug = typeof parsed.slug === 'string' ? parsed.slug.trim() : undefined;
        if (slug) {
          if (!SLUG_MANUAL_RE.test(slug)) {
            errors.push({
              file: entry,
              message: `slug inválido: "${slug}" — usa solo minúsculas, números y guiones (sin espacios, acentos ni guiones extremos)`,
            });
          } else {
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
    const config = await loadSiteConfig(cwd, { mode: 'validate' });
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
