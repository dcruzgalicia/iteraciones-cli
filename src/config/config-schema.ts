import { z } from 'zod';
import type { SiteConfig } from './site-config.js';

// ── Constantes ────────────────────────────────────────────────────────────

export const KNOWN_ACCENT_COLORS = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const;

/**
 * Todos los sub-esquemas usan `.strict()`: las claves desconocidas en
 * cualquier nivel generan issues `unrecognized_keys` que `config-loader.ts`
 * convierte en warnings (sin romper el build). El esquema es la única fuente
 * de verdad de las claves válidas — no hay listas paralelas que sincronizar.
 */

// ── HtmlFormatConfig ───────────────────────────────────────────────────────

const HtmlFormatSchema = z
  .object({
    title: z.string().default('iteraciones'),
    tagline: z.string().default('escribir, compartir, re-existir'),
    logo: z.string().default(''),
    theme: z.enum(['light', 'dark']).optional(),
    accent: z.enum(KNOWN_ACCENT_COLORS).optional().default('lime'),
    generate: z.boolean().default(true),
  })
  .strict();

// ── PdfFormatConfig ────────────────────────────────────────────────────────

const PdfFormatSchema = z
  .object({
    generate: z.boolean().default(false),
    toc: z.boolean().default(false),
    'show-date': z.boolean().default(false),
    'page-number': z.enum(['header-left', 'header-center', 'header-right', 'footer-left', 'footer-center', 'footer-right']).default('header-right'),
  })
  .strict();

// ── Epub, Markdown ─────────────────────────────────────────────────────────

const EpubFormatSchema = z
  .object({
    generate: z.boolean().default(false),
  })
  .strict();

const MarkdownFormatSchema = z
  .object({
    generate: z.boolean().default(false),
  })
  .strict();

// ── FormatConfig ───────────────────────────────────────────────────────────

const FormatSchema = z
  .object({
    latex: z.boolean().default(false),
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
    lang: z.string().default('es-MX'),
    format: FormatSchema.optional(),
    'disabled-filters': z
      .array(z.string())
      .optional()
      .transform((v) => (v?.length ? v : undefined)),
    'disabled-preamble-filters': z
      .array(z.string())
      .default(['16-eso-pic', '17-pdfx', '18-crop'])
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
    lang: (raw.lang as string) ?? 'es-MX',
    format: {
      latex: (f.latex as boolean) ?? false,
      html: htmlRaw
        ? (camelizeKeys(htmlRaw) as SiteConfig['format']['html'])
        : {
            title: 'iteraciones',
            tagline: 'escribir, compartir, re-existir',
            logo: '',
            theme: undefined,
            accent: 'lime',
            generate: true,
          },
      pdf: pdfRaw
        ? (camelizeKeys(pdfRaw) as SiteConfig['format']['pdf'])
        : { generate: false, toc: false, showDate: false, pageNumber: 'header-right' },
      epub: epubRaw ? (camelizeKeys(epubRaw) as SiteConfig['format']['epub']) : { generate: false },
      markdown: mdRaw ? (camelizeKeys(mdRaw) as SiteConfig['format']['markdown']) : { generate: false },
    },
    disabledFilters: raw['disabled-filters'],
    disabledPreambleFilters: raw['disabled-preamble-filters'],
    luaFilters: raw['lua-filters'],
  };
});
