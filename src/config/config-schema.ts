import { z } from 'zod';
import type { SiteConfig } from './site-config.js';
import { DEFAULT_PDF_FORMAT } from './site-config.js';

// ── Constantes ────────────────────────────────────────────────────────────

const KNOWN_ACCENT_COLORS = [
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

// ── HtmlFormatConfig ───────────────────────────────────────────────────────

const HtmlFormatSchema = z.object({
  theme: z.string().optional(),
  accent: z
    .string()
    .default('lime')
    .transform((v) => {
      if (!KNOWN_ACCENT_COLORS.includes(v as (typeof KNOWN_ACCENT_COLORS)[number])) {
        process.stderr.write(`[iteraciones] color de acento desconocido: "${v}". Usando "lime" por defecto.\n`);
        return 'lime';
      }
      return v;
    }),
  generate: z.boolean().default(false),
});

// ── PdfFormatConfig ────────────────────────────────────────────────────────

const DocumentClassSchema = z.object({
  class: z.enum(['scrartcl', 'scrbook']).default('scrbook'),
  options: z.array(z.string()).default(['12pt', 'sfdefaults=false', 'paper=letter', 'twoside']),
});

const SectionLevelSchema = z.object({
  beforeskip: z.string().optional(),
  afterskip: z.string().optional(),
  font: z.string().optional(),
  pagestyle: z.string().optional(),
});

const SectionLevelWithStyleSchema = SectionLevelSchema.extend({
  style: z.string().optional(),
  align: z.string().optional(),
});

const SectioningSchema = z.object({
  part: SectionLevelSchema.optional(),
  chapter: SectionLevelWithStyleSchema.optional(),
  section: SectionLevelWithStyleSchema.optional(),
  subsection: SectionLevelSchema.optional(),
  subsubsection: SectionLevelSchema.optional(),
  paragraph: SectionLevelSchema.optional(),
  subparagraph: SectionLevelSchema.optional(),
});

const PdfFormatSchema = z.object({
  generate: z.boolean().default(false),
  documentclass: DocumentClassSchema.optional(),
  geometry: z.object({ options: z.array(z.string()) }).optional(),
  babel: z.object({ options: z.array(z.string()) }).optional(),
  hyperref: z.object({ options: z.array(z.string()).default(['hidelinks']) }).optional(),
  microtype: z.object({ options: z.array(z.string()) }).optional(),
  enumitem: z.boolean().default(true),
  'font-family': z.array(z.object({ name: z.string(), options: z.array(z.string()).optional() })).optional(),
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
    .array(z.object({ command: z.string(), options: z.array(z.string()) }))
    .default([{ command: 'description', options: ['noitemsep', 'nosep', 'topsep=\\baselineskip'] }]),
  setcounter: z.record(z.string(), z.number()).default({ secnumdepth: 1, tocdepth: 1 }),
  sectioning: SectioningSchema.optional(),
  setkomafont: z.record(z.string(), z.string()).optional(),
  dictum: z.record(z.string(), z.string()).optional(),
  'eso-pic': z.union([z.boolean(), z.object({ options: z.array(z.string()) })]).default(false),
  pdfx: z.boolean().default(false),
  crop: z.boolean().default(false),
  'page-number': z.enum(PAGE_NUMBER_PLACEMENTS).default('header-right'),
  toc: z.boolean().default(false),
  'show-date': z.boolean().default(false),
});

// ── Epub, Markdown ─────────────────────────────────────────────────────────

const EpubFormatSchema = z.object({
  generate: z.boolean().default(false),
});

const MarkdownFormatSchema = z.object({
  generate: z.boolean().default(false),
});

// ── FormatConfig ───────────────────────────────────────────────────────────

const FormatSchema = z.object({
  latex: z.boolean().default(true),
  html: HtmlFormatSchema.optional(),
  pdf: PdfFormatSchema.optional(),
  epub: EpubFormatSchema.optional(),
  markdown: MarkdownFormatSchema.optional(),
});

// ── SiteConfig ─────────────────────────────────────────────────────────────

// Esquema intermedio que refleja la estructura del YAML
const RawSiteConfigSchema = z.object({
  site: z
    .object({
      title: z.string().default('iteraciones'),
      tagline: z.string().default('escribir, compartir, re-existir'),
      lang: z.string().default('es-MX'),
      logo: z.string().default(''),
      'base-url': z.string().default(''),
    })
    .optional(),
  format: FormatSchema.optional(),
  'disabled-transpilers': z
    .array(z.string())
    .optional()
    .transform((v) => (v?.length ? v : undefined)),
  'disabled-preamble-transpilers': z
    .array(z.string())
    .optional()
    .transform((v) => (v?.length ? v : undefined)),
  'lua-filters': z
    .array(z.string())
    .optional()
    .transform((v) => (v?.length ? v : undefined)),
});

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

// Transformar a SiteConfig (aplanar site: y format:, camelizar claves)
export const SiteConfigSchema = RawSiteConfigSchema.transform((raw) => {
  const s = raw.site ?? ({} as Record<string, unknown>);
  const f = raw.format ?? ({} as Record<string, unknown>);

  const pdfRaw = f.pdf as Record<string, unknown> | undefined;
  const htmlRaw = f.html as Record<string, unknown> | undefined;
  const epubRaw = f.epub as Record<string, unknown> | undefined;
  const mdRaw = f.markdown as Record<string, unknown> | undefined;

  return {
    title: (s.title as string) ?? 'iteraciones',
    tagline: (s.tagline as string) ?? 'escribir, compartir, re-existir',
    lang: (s.lang as string) ?? 'es-MX',
    logo: (s.logo as string) ?? '',
    baseUrl: ((s['base-url'] as string) || undefined) as string | undefined,
    format: {
      latex: (f.latex as boolean) ?? true,
      html: htmlRaw ? (camelizeKeys(htmlRaw) as SiteConfig['format']['html']) : { theme: undefined, accent: 'lime', generate: false },
      pdf: pdfRaw ? { ...DEFAULT_PDF_FORMAT, ...camelizeKeys(pdfRaw) } : { ...DEFAULT_PDF_FORMAT },
      epub: epubRaw ? (camelizeKeys(epubRaw) as SiteConfig['format']['epub']) : { generate: false },
      markdown: mdRaw ? (camelizeKeys(mdRaw) as SiteConfig['format']['markdown']) : { generate: false },
    },
    disabledTranspilers: raw['disabled-transpilers'],
    disabledPreambleTranspilers: raw['disabled-preamble-transpilers'],
    luaFilters: raw['lua-filters'],
  };
});
