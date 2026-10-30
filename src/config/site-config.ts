import type { SiteConfig } from './config-schema.js';

export const DEFAULT_HTML_BLOCKS = ['header', 'indice', 'formatos', 'contenido', 'referencias', 'footer'] as const;

export type HtmlBlockKey = (typeof DEFAULT_HTML_BLOCKS)[number];

export const DEFAULT_HTML_FORMAT = {
  site: {
    title: 'iteraciones',
    description: 'escribir, compartir, re-existir',
    logo: '',
    logoSize: '50px',
    theme: 'dark' as const,
    color: 'lime' as const,
    links: [] as { name: string; url: string }[],
  },
  generate: true,
  pageSize: 10,
};

export const DEFAULT_LATEX_FORMAT = {
  generate: false,
};

export const DEFAULT_PDF_FORMAT = {
  generate: false,
  disabledPreambleFilters: ['97-eso-pic', '98-crop', '99-pdfx'],
};

export const DEFAULT_EPUB_FORMAT = {
  generate: false,
};

export const DEFAULT_MARKDOWN_FORMAT = {
  generate: false,
  merge: false,
};

export function computeActiveFormats(format: Partial<SiteConfig['format']>): FormatKey[] {
  const formats: FormatKey[] = [];
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

  script: false,

  bundle: false,
  format: {
    html: DEFAULT_HTML_FORMAT,
    pdf: DEFAULT_PDF_FORMAT,
    epub: DEFAULT_EPUB_FORMAT,
    markdown: DEFAULT_MARKDOWN_FORMAT,
    latex: DEFAULT_LATEX_FORMAT,
  },
};

export type FormatKey = 'latex' | 'pdf' | 'html' | 'epub' | 'markdown';

export type ActiveFormats = Record<FormatKey, boolean>;

export function userWroteDisabledPreamble(presentKeys: ReadonlySet<string>): boolean {
  return presentKeys.has('format.pdf.disabledPreambleFilters') === true || presentKeys.has('disabledPreambleFilters') === true;
}

export function resolveDisabledPreambleConfig(siteConfig: {
  disabledPreambleFilters?: string[];
  format?: { pdf?: { disabledPreambleFilters?: string[] } };
}): string[] {
  return siteConfig.disabledPreambleFilters ?? siteConfig.format?.pdf?.disabledPreambleFilters ?? DEFAULT_PDF_FORMAT.disabledPreambleFilters;
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
