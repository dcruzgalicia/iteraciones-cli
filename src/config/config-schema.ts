import { z } from 'zod';
import { ACCENT_PALETTES, type AccentColor } from '../lib/accent-palettes.js';
import type { EpubFormatConfig, HtmlFormatConfig, MarkdownFormatConfig, PdfFormatConfig } from './site-config.js';
import { DEFAULT_EPUB_FORMAT, DEFAULT_HTML_FORMAT, DEFAULT_MARKDOWN_FORMAT, DEFAULT_PDF_FORMAT, DEFAULT_SITE_CONFIG } from './site-config.js';

// ── Constantes ────────────────────────────────────────────────────────────

/** Colores de acento validados por config; fuente única: ACCENT_PALETTES. */
export const KNOWN_ACCENT_COLORS = Object.keys(ACCENT_PALETTES) as AccentColor[];

/**
 * Todos los sub-esquemas usan `.strict()`: las claves desconocidas en
 * cualquier nivel generan issues `unrecognized_keys` que `config-loader.ts`
 * convierte en warnings (sin romper el build). El esquema es la única fuente
 * de verdad de las claves válidas — no hay listas paralelas que sincronizar.
 */

// ── HtmlFormatConfig ───────────────────────────────────────────────────────

/** Orden de bloques del masonry: enteros, claves conocidas (strict). */
const HtmlBlocksSchema = z
  .object({
    header: z.number().int().optional(),
    trayectura: z.number().int().optional(),
    formatos: z.number().int().optional(),
    indice: z.number().int().optional(),
    referencias: z.number().int().optional(),
    footer: z.number().int().optional(),
  })
  .strict();

const HtmlFormatSchema = z
  .object({
    title: z.string().default(DEFAULT_HTML_FORMAT.title),
    tagline: z.string().default(DEFAULT_HTML_FORMAT.tagline),
    logo: z.string().default(DEFAULT_HTML_FORMAT.logo),
    theme: z.enum(['light', 'dark']).optional().default(DEFAULT_HTML_FORMAT.theme),
    accent: z
      .enum(KNOWN_ACCENT_COLORS as [AccentColor, ...AccentColor[]])
      .optional()
      .default(DEFAULT_HTML_FORMAT.accent),
    generate: z.boolean().default(DEFAULT_HTML_FORMAT.generate),
    blocks: HtmlBlocksSchema.optional(),
  })
  .strict();

// ── PdfFormatConfig ────────────────────────────────────────────────────────

const PdfFormatSchema = z
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
  })
  .strict();

// ── Epub, Markdown ─────────────────────────────────────────────────────────

const EpubFormatSchema = z
  .object({
    generate: z.boolean().default(DEFAULT_EPUB_FORMAT.generate),
  })
  .strict();

const MarkdownFormatSchema = z
  .object({
    generate: z.boolean().default(DEFAULT_MARKDOWN_FORMAT.generate),
  })
  .strict();

// ── FormatConfig ───────────────────────────────────────────────────────────

const FormatSchema = z
  .object({
    latex: z.boolean().default(DEFAULT_SITE_CONFIG.format.latex),
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
    lang: z.string().default(DEFAULT_SITE_CONFIG.lang),
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
  })
  .strict();

/** Convierte kebab-case a camelCase. */
function toCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Aplica toCamel a todas las claves de un objeto (1 nivel). */
function camelizeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[toCamel(k)] = v;
  }
  return result;
}

// Transformar a SiteConfig (aplanar format:, camelizar claves).
// Los defaults del schema Zod y del transform son la única fuente de verdad.
export const SiteConfigSchema = RawSiteConfigSchema.transform((raw) => {
  const f = raw.format ?? ({} as Record<string, unknown>);

  const pdfRaw = f.pdf as Record<string, unknown> | undefined;
  const htmlRaw = f.html as Record<string, unknown> | undefined;
  const epubRaw = f.epub as Record<string, unknown> | undefined;
  const mdRaw = f.markdown as Record<string, unknown> | undefined;

  return {
    lang: raw.lang,
    toc: raw.toc,
    format: {
      latex: (f.latex as boolean | undefined) ?? DEFAULT_SITE_CONFIG.format.latex,
      html: htmlRaw ? (camelizeKeys(htmlRaw) as HtmlFormatConfig) : { ...DEFAULT_HTML_FORMAT },
      pdf: pdfRaw ? (camelizeKeys(pdfRaw) as PdfFormatConfig) : { ...DEFAULT_PDF_FORMAT },
      epub: epubRaw ? (camelizeKeys(epubRaw) as EpubFormatConfig) : { ...DEFAULT_EPUB_FORMAT },
      markdown: mdRaw ? (camelizeKeys(mdRaw) as MarkdownFormatConfig) : { ...DEFAULT_MARKDOWN_FORMAT },
    },
    disabledFilters: raw['disabled-filters'],
    luaFilters: raw['lua-filters'],
    bibliography: raw.bibliography,
    csl: raw.csl,
  };
});

/** Tipo de configuración derivado del schema Zod — única fuente de verdad. */
export type SiteConfig = z.infer<typeof SiteConfigSchema>;
