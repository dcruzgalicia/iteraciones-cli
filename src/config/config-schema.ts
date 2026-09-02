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

const KNOWN_ACCENT_COLORS = Object.keys(ACCENT_PALETTES) as AccentColor[];

const DublinCoreFieldsSchema = {
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
};

const TitlePageFieldsSchema = {
  subtitle: z.string().optional(),
  extratitle: z.string().optional(),
  frontispiece: z.string().optional(),
  titlehead: z.string().optional(),
  dedication: z.string().optional(),
  uppertitleback: z.string().optional(),
  lowertitleback: z.string().optional(),
  colophon: z.string().optional(),
};

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

export const PdfFormatSchema = z
  .object({
    generate: z.boolean().default(DEFAULT_PDF_FORMAT.generate),
    showDate: z.boolean().default(DEFAULT_PDF_FORMAT.showDate),
    pageNumber: z
      .enum(['header-left', 'header-center', 'header-right', 'footer-left', 'footer-center', 'footer-right'])
      .default(DEFAULT_PDF_FORMAT.pageNumber),
    disabledPreambleFilters: z
      .array(z.string())
      .default(DEFAULT_PDF_FORMAT.disabledPreambleFilters)
      .transform((v) => (v?.length ? v : undefined)),
    coverImage: z.boolean().default(DEFAULT_PDF_FORMAT.coverImage ?? false),
    ...DublinCoreFieldsSchema,
    ...TitlePageFieldsSchema,
  })
  .strict();

export const LatexFormatSchema = z
  .object({
    generate: z.boolean().default(DEFAULT_LATEX_FORMAT.generate),
  })
  .strict();

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

const FormatSchema = z
  .object({
    latex: LatexFormatSchema.optional(),
    html: HtmlFormatSchema.optional(),
    pdf: PdfFormatSchema.optional(),
    epub: EpubFormatSchema.optional(),
    markdown: MarkdownFormatSchema.optional(),
  })
  .strict();

export const SiteConfigSchema = z
  .object({
    language: z.string().default(DEFAULT_SITE_CONFIG.language),
    toc: z.boolean().default(DEFAULT_SITE_CONFIG.toc),
    format: FormatSchema.optional(),
    bibliography: z.string().optional(),
    csl: z.string().optional(),
    disabledFilters: z
      .array(z.string())
      .optional()
      .transform((v) => (v?.length ? v : undefined)),
    luaFilters: z
      .array(z.string())
      .optional()
      .transform((v) => (v?.length ? v : undefined)),
    ...DublinCoreFieldsSchema,
    ...TitlePageFieldsSchema,
  })
  .strict()
  .transform((raw) => ({
    ...raw,
    format: {
      latex: raw.format?.latex ?? { ...DEFAULT_LATEX_FORMAT },
      html: raw.format?.html ?? { ...DEFAULT_HTML_FORMAT },
      pdf: raw.format?.pdf ?? { ...DEFAULT_PDF_FORMAT },
      epub: raw.format?.epub ?? { ...DEFAULT_EPUB_FORMAT },
      markdown: raw.format?.markdown ?? { ...DEFAULT_MARKDOWN_FORMAT },
    },
  }));

export type SiteConfig = z.infer<typeof SiteConfigSchema>;
