import { z } from 'zod';
import { ACCENT_PALETTES, type AccentColor } from '../lib/accent-palettes.js';
import type { HtmlBlockKey } from './site-config.js';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_BLOCKS,
  DEFAULT_HTML_FORMAT,
  DEFAULT_LATEX_FORMAT,
  DEFAULT_MARKDOWN_FORMAT,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
} from './site-config.js';

// ── Constantes ────────────────────────────────────────────────────────────

/**
 * Mensajes de error de Zod en español (la CLI es íntegramente en español).
 * Configuración global del proceso: solo se usa para la config del proyecto.
 * Los accesos a campos específicos de cada issue usan casts acotados (los
 * tipos internos de Zod v4 no exponen todos los campos del runtime).
 */
z.setErrorMap(((issue: z.ZodIssue) => {
  if (issue.code === 'invalid_type') {
    const expected = (issue as { expected?: string }).expected ?? 'valor';
    const input = (issue as { input?: unknown }).input;
    const received = typeof input === 'string' ? input : JSON.stringify(input ?? 'desconocido');
    return { message: `se esperaba ${expected}, se recibió ${received}` };
  }
  if (issue.code === 'invalid_value') {
    const values = (issue as { values?: unknown[] }).values ?? [];
    const list = values.map((o) => JSON.stringify(o)).join(', ');
    return { message: list ? `valor no válido: se esperaba uno de ${list}` : 'valor no válido' };
  }
  if (issue.code === 'too_small') {
    return { message: `muy corto: mínimo ${issue.minimum}` };
  }
  if (issue.code === 'too_big') {
    return { message: `muy largo: máximo ${issue.maximum}` };
  }
  return { message: issue.message };
}) as unknown as z.ZodErrorMap);

/** Colores de acento validados por config; fuente única: ACCENT_PALETTES. */
const KNOWN_ACCENT_COLORS = Object.keys(ACCENT_PALETTES) as AccentColor[];

/**
 * Todos los sub-esquemas usan `.strict()`: las claves desconocidas en
 * cualquier nivel generan issues `unrecognized_keys` que `config-loader.ts`
 * convierte en warnings (sin romper el build). El esquema es la única fuente
 * de verdad de las claves válidas — no hay listas paralelas que sincronizar.
 */

// ── HtmlFormatConfig ───────────────────────────────────────────────────────

/**
 * Orden de bloques del masonry: lista de claves conocidas; la posición ES el
 * orden. Mensajes accionables: la sintaxis anterior (objeto con números) y un
 * nombre desconocido explican cómo corregir la configuración.
 */
const HtmlBlocksSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'debe ser una lista de bloques en orden (p. ej. [header, contenido, formatos, indice, referencias, footer]) — antes era un objeto con números',
      });
      return;
    }
    for (const item of value) {
      if (typeof item !== 'string' || !DEFAULT_HTML_BLOCKS.includes(item as HtmlBlockKey)) {
        ctx.addIssue({ code: 'custom', message: `"${String(item)}" no es un bloque conocido: usa solo ${DEFAULT_HTML_BLOCKS.join(', ')}` });
      }
    }
  })
  .transform((value): HtmlBlockKey[] | undefined => (Array.isArray(value) ? (value as HtmlBlockKey[]) : undefined));

const HtmlSiteSchema = z
  .object({
    title: z.string().default(DEFAULT_HTML_FORMAT.site?.title ?? 'iteraciones'),
    description: z.string().default(DEFAULT_HTML_FORMAT.site?.description ?? 'escribir, compartir, re-existir'),
    logo: z.string().default(DEFAULT_HTML_FORMAT.site?.logo ?? ''),
    theme: z
      .enum(['light', 'dark'])
      .optional()
      .default(DEFAULT_HTML_FORMAT.site?.theme ?? 'dark'),
    color: z
      .enum(KNOWN_ACCENT_COLORS as [AccentColor, ...AccentColor[]])
      .optional()
      .default(DEFAULT_HTML_FORMAT.site?.color ?? 'lime'),
  })
  .strict();

export const HtmlFormatSchema = z
  .object({
    site: HtmlSiteSchema.optional(),
    generate: z.boolean().default(DEFAULT_HTML_FORMAT.generate),
    blocks: HtmlBlocksSchema.optional(),
  })
  .strict();

// ── PdfFormatConfig ────────────────────────────────────────────────────────

export const PdfFormatSchema = z
  .object({
    generate: z.boolean().default(DEFAULT_PDF_FORMAT.generate),
    'show-date': z.boolean().default(DEFAULT_PDF_FORMAT.showDate),
    'page-number': z
      .enum(['header-left', 'header-center', 'header-right', 'footer-left', 'footer-center', 'footer-right'])
      .default(DEFAULT_PDF_FORMAT.pageNumber),
    'disabled-preamble-filters': z
      .array(z.string())
      .default(DEFAULT_PDF_FORMAT.disabledPreambleFilters)
      .transform((v) => (v?.length ? v : undefined)),
    'cover-image': z.boolean().default(DEFAULT_PDF_FORMAT.coverImage ?? false),
    // Dublin Core fields (defaults for PDF format)
    title: z.string().optional(),
    creator: z.union([z.string(), z.array(z.string())]).optional(),
    subject: z.union([z.string(), z.array(z.string())]).optional(),
    description: z.string().optional(),
    publisher: z.union([z.string(), z.array(z.string())]).optional(),
    contributor: z.union([z.string(), z.array(z.string())]).optional(),
    date: z.string().optional(),
    identifier: z.string().optional(),
    source: z.string().optional(),
    relation: z.union([z.string(), z.array(z.string())]).optional(),
    coverage: z.string().optional(),
    rights: z.string().optional(),
    license: z.string().optional(),
    doi: z.string().optional(),
    isbn: z.string().optional(),
    abstract: z.string().optional(),
  })
  .strict();

// ── LatexFormatConfig ────────────────────────────────────────────────────────

export const LatexFormatSchema = z
  .object({
    generate: z.boolean().default(DEFAULT_LATEX_FORMAT.generate),
  })
  .strict();

// ── Epub, Markdown ─────────────────────────────────────────────────────────

export const EpubFormatSchema = z
  .object({
    generate: z.boolean().default(DEFAULT_EPUB_FORMAT.generate),
  })
  .strict();

export const MarkdownFormatSchema = z
  .object({
    generate: z.boolean().default(DEFAULT_MARKDOWN_FORMAT.generate),
  })
  .strict();

// ── FormatConfig ───────────────────────────────────────────────────────────

const FormatSchema = z
  .object({
    latex: LatexFormatSchema.optional(),
    html: HtmlFormatSchema.optional(),
    pdf: PdfFormatSchema.optional(),
    epub: EpubFormatSchema.optional(),
    markdown: MarkdownFormatSchema.optional(),
  })
  .strict();

// ── SiteConfig ─────────────────────────────────────────────────────────────

// Esquema intermedio que refleja la estructura del YAML
const RawSiteConfigSchema = z
  .object({
    language: z.string().default(DEFAULT_SITE_CONFIG.language),
    toc: z.boolean().default(DEFAULT_SITE_CONFIG.toc),
    format: FormatSchema.optional(),
    bibliography: z.string().optional(),
    csl: z.string().optional(),
    'disabled-filters': z
      .array(z.string())
      .optional()
      .transform((v) => (v?.length ? v : undefined)),
    'lua-filters': z
      .array(z.string())
      .optional()
      .transform((v) => (v?.length ? v : undefined)),
    // Dublin Core fields (defaults for all documents)
    title: z.string().optional(),
    creator: z.union([z.string(), z.array(z.string())]).optional(),
    subject: z.union([z.string(), z.array(z.string())]).optional(),
    description: z.string().optional(),
    publisher: z.union([z.string(), z.array(z.string())]).optional(),
    contributor: z.union([z.string(), z.array(z.string())]).optional(),
    date: z.string().optional(),
    identifier: z.string().optional(),
    source: z.string().optional(),
    relation: z.union([z.string(), z.array(z.string())]).optional(),
    coverage: z.string().optional(),
    rights: z.string().optional(),
    license: z.string().optional(),
    doi: z.string().optional(),
    isbn: z.string().optional(),
    abstract: z.string().optional(),
  })
  .strict();

/** Convierte kebab-case a camelCase a nivel de tipo (issue #2072). */
type CamelKey<K extends string> = K extends `${infer Head}-${infer Rest}` ? `${Head}${Capitalize<CamelKey<Rest>>}` : K;

/** Mapea las claves kebab-case de T a camelCase conservando los tipos de valor. */
export type Camelize<T> = { [K in keyof T as K extends string ? CamelKey<K> : K]: T[K] };

/** Convierte kebab-case a camelCase. */
function toCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Aplica toCamel a todas las claves de un objeto (1 nivel), con tipos reales. */
function camelizeKeys<T extends object>(obj: T): Camelize<T> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[toCamel(k)] = v;
  }
  return result as Camelize<T>;
}

/**
 * Sección `format.<x>` materializada: la salida camelizada del schema si el
 * usuario configuró el bloque, o el default del paquete si no. El tipo único
 * Camelize<T> evita el union entre rama configurada y rama default y elimina
 * los casts que antes puenteaban Zod hacia las interfaces manuales (#2072).
 */
function formatSection<T extends object>(raw: T | undefined, fallback: Camelize<T>): Camelize<T> {
  return raw ? camelizeKeys(raw) : fallback;
}

// Transformar a SiteConfig (aplanar format:, camelizar claves).
// Los defaults del schema Zod y del transform son la única fuente de verdad.
export const SiteConfigSchema = RawSiteConfigSchema.transform((raw) => {
  const f = raw.format ?? {};

  return {
    language: raw.language,
    toc: raw.toc,
    format: {
      latex: formatSection(f.latex, { ...DEFAULT_LATEX_FORMAT }),
      html: formatSection(f.html, { ...DEFAULT_HTML_FORMAT }),
      pdf: formatSection(f.pdf, { ...DEFAULT_PDF_FORMAT }),
      epub: formatSection(f.epub, { ...DEFAULT_EPUB_FORMAT }),
      markdown: formatSection(f.markdown, { ...DEFAULT_MARKDOWN_FORMAT }),
    },
    disabledFilters: raw['disabled-filters'],
    luaFilters: raw['lua-filters'],
    bibliography: raw.bibliography,
    csl: raw.csl,
    // Dublin Core fields
    title: raw.title,
    creator: raw.creator,
    subject: raw.subject,
    description: raw.description,
    publisher: raw.publisher,
    contributor: raw.contributor,
    date: raw.date,
    identifier: raw.identifier,
    source: raw.source,
    relation: raw.relation,
    coverage: raw.coverage,
    rights: raw.rights,
    license: raw.license,
    doi: raw.doi,
    isbn: raw.isbn,
    abstract: raw.abstract,
  };
});

/** Tipo de configuración derivado del schema Zod — única fuente de verdad. */
export type SiteConfig = z.infer<typeof SiteConfigSchema>;
