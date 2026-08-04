import { z } from 'zod';
import type { SiteConfig } from './site-config.js';
import { DEFAULT_PDF_FORMAT } from './site-config.js';

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

const PAGE_NUMBER_PLACEMENTS = ['footer-left', 'footer-center', 'footer-right', 'header-left', 'header-center', 'header-right'] as const;

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
    'base-url': z
      .string()
      .default('')
      .transform((v) => (v || undefined) as string | undefined),
    theme: z.string().optional(),
    accent: z.string().default('lime'),
    generate: z.boolean().default(false),
  })
  .strict();

// ── PdfFormatConfig ────────────────────────────────────────────────────────

const DocumentClassSchema = z
  .object({
    class: z.enum(['scrartcl', 'scrbook']).default('scrbook'),
    options: z.array(z.string()).default(['12pt', 'sfdefaults=false', 'paper=letter', 'twoside']),
  })
  .strict();

const SectionLevelSchema = z
  .object({
    beforeskip: z.string().optional(),
    afterskip: z.string().optional(),
    font: z.string().optional(),
    pagestyle: z.string().optional(),
  })
  .strict();

const SectionLevelWithStyleSchema = SectionLevelSchema.extend({
  style: z.string().optional(),
  align: z.string().optional(),
}).strict();

const SectioningSchema = z
  .object({
    part: SectionLevelSchema.optional(),
    chapter: SectionLevelWithStyleSchema.optional(),
    section: SectionLevelWithStyleSchema.optional(),
    subsection: SectionLevelSchema.optional(),
    subsubsection: SectionLevelSchema.optional(),
    paragraph: SectionLevelSchema.optional(),
    subparagraph: SectionLevelSchema.optional(),
  })
  .strict();

const PdfFormatSchema = z
  .object({
    generate: z.boolean().default(false),
    documentclass: DocumentClassSchema.optional(),
    geometry: z
      .object({ options: z.array(z.string()) })
      .strict()
      .optional(),
    babel: z
      .object({ options: z.array(z.string()) })
      .strict()
      .optional(),
    hyperref: z
      .object({ options: z.array(z.string()).default(['hidelinks']) })
      .strict()
      .optional(),
    microtype: z
      .object({ options: z.array(z.string()) })
      .strict()
      .optional(),
    enumitem: z.boolean().default(true),
    'font-family': z.array(z.object({ name: z.string(), options: z.array(z.string()).optional() }).strict()).optional(),
    setspace: z.boolean().default(true),
    setstretch: z.number().positive().default(1.5),
    raggedbottom: z.boolean().default(true),
    pretolerance: z.number().default(200),
    tolerance: z.number().default(400),
    brokenpenalty: z.number().default(1_000_000),
    hyphenpenalty: z.number().default(100),
    finalhyphendemerits: z.number().default(1_000_000),
    doublehyphendemerits: z.number().default(1_000_000),
    widowpenalty: z.number().default(1_000_000),
    clubpenalty: z.number().default(1_000_000),
    setlist: z
      .array(z.object({ command: z.string(), options: z.array(z.string()) }).strict())
      .default([{ command: 'description', options: ['noitemsep', 'nosep', 'topsep=\\baselineskip'] }]),
    setcounter: z.record(z.string(), z.number()).default({ secnumdepth: 1, tocdepth: 1 }),
    sectioning: SectioningSchema.optional(),
    setkomafont: z.record(z.string(), z.string()).optional(),
    dictum: z.record(z.string(), z.string()).optional(),
    'eso-pic': z.union([z.boolean(), z.object({ options: z.array(z.string()) }).strict()]).default(false),
    pdfx: z.boolean().default(false),
    crop: z.boolean().default(false),
    'page-number': z.enum(PAGE_NUMBER_PLACEMENTS).default('header-right'),
    toc: z.boolean().default(false),
    'show-date': z.boolean().default(false),
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
    latex: z.boolean().default(true),
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

// Transformar a SiteConfig (aplanar format:, camelizar claves)
export const SiteConfigSchema = RawSiteConfigSchema.transform((raw) => {
  const f = raw.format ?? ({} as Record<string, unknown>);

  const pdfRaw = f.pdf as Record<string, unknown> | undefined;
  const htmlRaw = f.html as Record<string, unknown> | undefined;
  const epubRaw = f.epub as Record<string, unknown> | undefined;
  const mdRaw = f.markdown as Record<string, unknown> | undefined;

  return {
    lang: (raw.lang as string) ?? 'es-MX',
    format: {
      latex: (f.latex as boolean) ?? true,
      html: htmlRaw
        ? (camelizeKeys(htmlRaw) as SiteConfig['format']['html'])
        : {
            title: 'iteraciones',
            tagline: 'escribir, compartir, re-existir',
            logo: '',
            baseUrl: undefined,
            theme: undefined,
            accent: 'lime',
            generate: false,
          },
      pdf: pdfRaw ? { ...DEFAULT_PDF_FORMAT, ...camelizeKeys(pdfRaw) } : { ...DEFAULT_PDF_FORMAT },
      epub: epubRaw ? (camelizeKeys(epubRaw) as SiteConfig['format']['epub']) : { generate: false },
      markdown: mdRaw ? (camelizeKeys(mdRaw) as SiteConfig['format']['markdown']) : { generate: false },
    },
    disabledFilters: raw['disabled-filters'],
    disabledPreambleFilters: raw['disabled-preamble-filters'],
    luaFilters: raw['lua-filters'],
  };
});
