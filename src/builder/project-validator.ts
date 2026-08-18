import { isAbsolute, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';

/**
 * Validación de proyecto compartida entre build (discover/orchestrator) y
 * validate. Única fuente de verdad de los checks de campos del frontmatter y
 * de rutas de configuración: build y validate fallan sobre los mismos archivos
 * con los mismos mensajes (contrato registrado en docs/architecture.md,
 * "¿Cuál es el contrato entre build y validate?").
 *
 * La sintaxis YAML y la separación frontmatter/body NO viven aquí: cada
 * consumidor las maneja con parseYamlWithPosition/splitFrontmatter según su
 * flujo. Este módulo valida el objeto YAML ya parseado.
 */

export interface ValidationIssue {
  /** Error (rompe build/validate) o warning (no rompe). */
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Campos del frontmatter que el pipeline consume: los del pipeline
 * (title/subtitle/date/author/slug) y los que fluyen a pandoc o al template
 * efectivo con efecto visible (lang, toc, description, site-title, tagline,
 * theme, accent, css). Cualquier otro campo se descarta en todos los formatos:
 * validate y el build advierten para que no sea silencioso.
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

/**
 * Valida los campos de un objeto de frontmatter ya parseado. Los errores
 * (tipos incorrectos, slug con formato inseguro) rompen build y validate; los
 * warnings (date no ISO, campos ignorados) se muestran en ambos sin romper.
 * No incluye el slug manual duplicado: requiere estado entre documentos y lo
 * gestiona cada consumidor (validate lo rastrea por archivo; slug-resolver
 * cubre todas las colisiones en el build).
 */
export function validateFrontmatterFields(parsed: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Tipos de los campos conocidos: un tipo incorrecto es un error (el
  // pipeline lo degradaría o lo ignoraría en silencio, p. ej. title: 123
  // → "Sin título").
  for (const field of STRING_FRONTMATTER_FIELDS) {
    const value = parsed[field];
    if (value !== undefined && typeof value !== 'string') {
      issues.push({ severity: 'error', message: `frontmatter: "${field}" debe ser un texto (string), se recibió ${typeof value}` });
    }
  }
  const author = parsed.author;
  if (author !== undefined && typeof author !== 'string' && !(Array.isArray(author) && author.every((a) => typeof a === 'string'))) {
    issues.push({ severity: 'error', message: 'frontmatter: "author" debe ser un texto o una lista de textos' });
  }
  // date con formato libre: el pipeline la acepta deliberadamente
  // (formatHumanDate la deja pasar sin romper), pero el formato ISO es
  // el documentado: advertencia, no error.
  const date = parsed.date;
  if (typeof date === 'string' && date.trim() !== '' && !DATE_ISO_RE.test(date.trim())) {
    issues.push({ severity: 'warning', message: 'frontmatter: "date" no usa el formato ISO YYYY-MM-DD; se mostrará tal cual' });
  }
  const unknown = unknownFrontmatterFields(parsed);
  if (unknown.length > 0) {
    issues.push({ severity: 'warning', message: `campos de frontmatter ignorados por el pipeline: ${unknown.join(', ')}` });
  }
  // Slug manual: formato seguro (minúsculas, números y guiones simples).
  const slug = typeof parsed.slug === 'string' ? parsed.slug.trim() : undefined;
  if (slug && !SLUG_MANUAL_RE.test(slug)) {
    issues.push({
      severity: 'error',
      message: `slug inválido: "${slug}" — usa solo minúsculas, números y guiones (sin espacios, acentos ni guiones extremos)`,
    });
  }
  return issues;
}

/**
 * Verifica que las rutas configuradas del proyecto existan. bibliography y csl
 * configurados e inexistentes son un error (config inválida; el
 * auto-descubrimiento solo aplica cuando no se configuró nada); lua-filters
 * inexistentes son un warning (se omiten).
 */
export async function validateConfigFilePaths(cwd: string, config: SiteConfig): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const rel of config.luaFilters ?? []) {
    if (!(await Bun.file(join(cwd, rel)).exists())) {
      issues.push({ severity: 'warning', message: `lua-filters: "${rel}" no encontrado en el proyecto` });
    }
  }
  for (const key of ['bibliography', 'csl'] as const) {
    const rel = config[key];
    if (!rel) continue;
    const abs = isAbsolute(rel) ? rel : join(cwd, rel);
    if (!(await Bun.file(abs).exists())) {
      issues.push({ severity: 'error', message: `${key}: "${rel}" no encontrado en el proyecto` });
    }
  }
  return issues;
}
