export const DEFAULT_HTML_BLOCKS = ['header', 'contenido', 'formatos', 'indice', 'referencias', 'footer'] as const;

export type HtmlBlockKey = (typeof DEFAULT_HTML_BLOCKS)[number];

interface HtmlSiteConfig {
  title?: string;
  description?: string;
  logo?: string;
  theme?: string;
  color?: string;
}

export interface HtmlFormatConfig {
  site?: HtmlSiteConfig;
  generate?: boolean;
  blocks?: HtmlBlockKey[];
}

export interface PdfFormatConfig {
  generate?: boolean;
  showDate?: boolean;
  pageNumber?: string;
  disabledPreambleFilters?: string[];
  coverImage?: boolean;
  courtesyPage?: boolean;
}

export interface LatexFormatConfig {
  generate?: boolean;
}

export interface EpubFormatConfig {
  generate?: boolean;
}

export interface MarkdownFormatConfig {
  generate?: boolean;
}

export interface FormatConfig {
  html?: HtmlFormatConfig;
  pdf?: PdfFormatConfig;
  epub?: EpubFormatConfig;
  markdown?: MarkdownFormatConfig;
  latex?: LatexFormatConfig;
}

export const DEFAULT_HTML_FORMAT = {
  site: {
    title: 'iteraciones',
    description: 'escribir, compartir, re-existir',
    logo: '',
    theme: 'dark' as const,
    color: 'lime' as const,
  },
  generate: true,
} satisfies HtmlFormatConfig;

export const DEFAULT_LATEX_FORMAT = {
  generate: false,
} satisfies LatexFormatConfig;

export const DEFAULT_PDF_FORMAT = {
  generate: false,
  showDate: false,
  pageNumber: 'header-right' as const,
  disabledPreambleFilters: ['97-eso-pic', '98-crop', '99-pdfx'],
  coverImage: false,
  courtesyPage: false,
} satisfies PdfFormatConfig;

export const DEFAULT_EPUB_FORMAT = {
  generate: false,
} satisfies EpubFormatConfig;

export const DEFAULT_MARKDOWN_FORMAT = {
  generate: false,
} satisfies MarkdownFormatConfig;

export function computeActiveFormats(format: FormatConfig): string[] {
  const formats: string[] = [];
  if (format.latex?.generate === true) formats.push('latex');
  if (format.pdf?.generate === true) formats.push('pdf');
  if (format.html?.generate === true) formats.push('html');
  if (format.epub?.generate === true) formats.push('epub');
  if (format.markdown?.generate === true) formats.push('markdown');
  return formats;
}

export const DEFAULT_SITE_CONFIG = {
  language: 'es-MX',
  toc: false,
  disabledFilters: undefined,
  luaFilters: undefined,
  bibliography: undefined,
  csl: undefined,
  courtesyPage: false,
  format: {
    html: DEFAULT_HTML_FORMAT,
    pdf: DEFAULT_PDF_FORMAT,
    epub: DEFAULT_EPUB_FORMAT,
    markdown: DEFAULT_MARKDOWN_FORMAT,
    latex: DEFAULT_LATEX_FORMAT,
  },
  title: undefined,
  creator: undefined,
  subject: undefined,
  description: undefined,
  publisher: undefined,
  contributor: undefined,
  date: undefined,
  identifier: undefined,
  source: undefined,
  relation: undefined,
  coverage: undefined,
  rights: undefined,
  license: undefined,
  doi: undefined,
  isbn: undefined,
  abstract: undefined,
};

export type FormatKey = 'latex' | 'pdf' | 'html' | 'epub' | 'markdown';

export type ActiveFormats = Record<FormatKey, boolean>;

export interface DisabledPreambleConfigSource {
  disabledPreambleFilters?: string[];
  format?: { pdf?: { disabledPreambleFilters?: string[] } };
}

export function resolveDisabledPreambleConfig(siteConfig: DisabledPreambleConfigSource): string[] {
  return siteConfig.disabledPreambleFilters ?? siteConfig.format?.pdf?.disabledPreambleFilters ?? DEFAULT_PDF_FORMAT.disabledPreambleFilters;
}

export interface EffectivePdfConfig {
  showDate?: boolean;
  pageNumber?: string;
  coverImage?: boolean;
  courtesyPage?: boolean;
  disabledPreambleFilters?: string[];
  titleImage?: string;
  publisherImage?: string | string[];
  endpapers?: string;
}

export interface PdfConfigSource {
  showDate?: boolean;
  pageNumber?: string;
  coverImage?: boolean;
  courtesyPage?: boolean;
  disabledPreambleFilters?: string[];
  titleImage?: string;
  publisherImage?: string | string[];
  endpapers?: string;
}

export function effectivePdfConfig(siteConfig: {
  showDate?: boolean;
  pageNumber?: string;
  coverImage?: boolean;
  courtesyPage?: boolean;
  disabledPreambleFilters?: string[];
  titleImage?: string;
  publisherImage?: string | string[];
  endpapers?: string;
  format?: { pdf?: PdfConfigSource };
}): EffectivePdfConfig {
  const pdf: PdfConfigSource = siteConfig.format?.pdf ?? {};
  return {
    showDate: siteConfig.showDate ?? pdf.showDate,
    pageNumber: siteConfig.pageNumber ?? pdf.pageNumber,
    coverImage: siteConfig.coverImage ?? pdf.coverImage,
    courtesyPage: siteConfig.courtesyPage ?? pdf.courtesyPage,
    disabledPreambleFilters: siteConfig.disabledPreambleFilters ?? pdf.disabledPreambleFilters,
    titleImage: siteConfig.titleImage ?? pdf.titleImage,
    publisherImage: siteConfig.publisherImage ?? pdf.publisherImage,
    endpapers: siteConfig.endpapers ?? pdf.endpapers,
  };
}

export function toActiveFormats(formats: FormatKey[]): ActiveFormats {
  return {
    latex: formats.includes('latex'),
    pdf: formats.includes('pdf'),
    html: formats.includes('html'),
    epub: formats.includes('epub'),
    markdown: formats.includes('markdown'),
  };
}
