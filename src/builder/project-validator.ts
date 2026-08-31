import { isAbsolute, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';

interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

export const MISSING_TITLE_WARNING: ValidationIssue = {
  severity: 'warning',
  message: 'no tiene título en el frontmatter; se usará "Sin título"',
};

export const KNOWN_FRONTMATTER_FIELDS = [
  'title',
  'creator',
  'subject',
  'description',
  'publisher',
  'contributor',
  'date',
  'identifier',
  'source',
  'language',
  'relation',
  'coverage',
  'rights',
  'subtitle',
  'slug',
  'toc',
  'keywords',
  'license',
  'doi',
  'isbn',
  'abstract',
  'site-title',
  'tagline',
  'theme',
  'accent',
  'css',
  'extratitle',
  'frontispiece',
  'titlehead',
  'dedication',
  'uppertitleback',
  'lowertitleback',
  'colophon',
  'title-image',
  'publishers-image',
  'endpapers',
];

const SLUG_MANUAL_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const STRING_FRONTMATTER_FIELDS = ['title', 'subtitle', 'date'];

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function unknownFrontmatterFields(parsed: Record<string, unknown>): string[] {
  return Object.keys(parsed).filter((key) => !KNOWN_FRONTMATTER_FIELDS.includes(key));
}

export function validateFrontmatterFields(parsed: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of STRING_FRONTMATTER_FIELDS) {
    const value = parsed[field];
    if (value !== undefined && typeof value !== 'string') {
      issues.push({ severity: 'error', message: `frontmatter: "${field}" debe ser un texto (string), se recibió ${typeof value}` });
    }
  }
  const creator = parsed.creator;
  if (creator !== undefined && typeof creator !== 'string' && !(Array.isArray(creator) && creator.every((a) => typeof a === 'string'))) {
    issues.push({ severity: 'error', message: 'frontmatter: "creator" debe ser un texto o una lista de textos' });
  }
  const date = parsed.date;
  if (typeof date === 'string' && date.trim() !== '' && !DATE_ISO_RE.test(date.trim())) {
    issues.push({ severity: 'warning', message: 'frontmatter: "date" no usa el formato ISO YYYY-MM-DD; se mostrará tal cual' });
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!KNOWN_FRONTMATTER_FIELDS.includes(key)) continue;
    if (value === undefined) continue;
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      issues.push({ severity: 'warning', message: `frontmatter: "${key}" está vacío; se omitirá del metadato` });
    }
  }
  const unknown = unknownFrontmatterFields(parsed);
  if (unknown.length > 0) {
    issues.push({ severity: 'warning', message: `campos de frontmatter ignorados por el pipeline: ${unknown.join(', ')}` });
  }
  const slug = typeof parsed.slug === 'string' ? parsed.slug.trim() : undefined;
  if (slug && !SLUG_MANUAL_RE.test(slug)) {
    issues.push({
      severity: 'error',
      message: `slug inválido: "${slug}" — usa solo minúsculas, números y guiones (sin espacios, acentos ni guiones extremos)`,
    });
  }
  return issues;
}

export function looseColonLines(body: string, lineOffset = 0): number[] {
  const hits: number[] = [];
  let inCode = false;
  let divDepth = 0;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trimEnd();
    if (/^(```|~~~)/.test(trimmed)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (/^:::\s*\{/.test(trimmed)) {
      divDepth += 1;
      continue;
    }
    if (trimmed === ':::' && divDepth > 0) {
      divDepth -= 1;
      continue;
    }
    if (trimmed === '::' || trimmed === ':;') continue;
    if (/^:+$/.test(trimmed)) hits.push(i + 1 + lineOffset);
  }
  return hits;
}

export function looseColonsMessage(lines: number[]): string {
  const where = lines.length === 1 ? `línea ${lines[0]}` : `líneas ${lines.join(', ')}`;
  return `${where} con ":" suelta: ¿querías escribir "::" (espacio vertical) o ":;" (sin indentación)?`;
}

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
