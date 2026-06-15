export type PageSize = 'half-letter' | 'letter' | 'legal' | 'executive' | 'a3' | 'a4' | 'a5' | 'b4' | 'b5' | 'tabloid' | 'pocket' | (string & {});

export type PageNumberPlacement = 'footer-left' | 'footer-center' | 'footer-right' | 'header-left' | 'header-center' | 'header-right';

export type Sides = 'oneside' | 'twoside';

// ── Schema `format:` (estilo Quarto) ──

export interface PaginationConfig {
  limit: number;
}

export interface HtmlFormatConfig {
  theme?: string;
  accent?: string;
  math?: 'none' | 'katex' | 'mathjax';
  toc: boolean;
  tocDepth: number;
  hyphenation: boolean;
}

export interface PdfFormatConfig {
  engine: 'pdflatex';
  concurrency: number;
  toc?: boolean;
  tocDepth?: number;
  numbering?: boolean;
  hyphenation: boolean;
  pdfx: boolean;
  bibliography?: string;
  csl?: string;
  pageSize?: string;
  fontSize?: string;
  fontFamily?: string;
  margins?: [string, string, string, string];
  lineSpacing?: number;
  pageNumber?: PageNumberPlacement;
  sides?: Sides;
  documentclass?: 'scrartcl' | 'scrbook';
  /** Division top-level para pandoc: section (default), chapter o part. */
  topLevelDivision?: 'section' | 'chapter' | 'part';
  sfdefaults?: boolean;
  /**
   * Cuando es true, el estilo plain (usado en primera pagina de contenido
   * y paginas de section) respeta la posicion header configurada en
   * page-number, en lugar de usar footer-center.
   * Solo aplica cuando page-number es header-*. Por defecto false.
   */
  respectHeaderPlain?: boolean;
}

export interface EpubFormatConfig {
  toc?: boolean;
  tocDepth?: number;
  bibliography?: string;
  csl?: string;
}

export interface FormatConfig {
  html?: HtmlFormatConfig;
  pdf?: PdfFormatConfig;
  epub?: EpubFormatConfig;
}

// ── SiteConfig ──

export interface SiteConfig {
  title: string;
  tagline: string;
  lang: string;
  logo: string;
  baseUrl: string | undefined;
  plugins: string[];
  /** Configuracion de paginacion de listas. */
  pagination: PaginationConfig;
  /** Configuracion por formato de salida. */
  format: FormatConfig;
}

/**
 * Colores Tailwind v4 con escala completa 50-950 válidos como acento.
 * Excluye white, black, transparent y similares que no tienen escala.
 */
export const KNOWN_ACCENT_COLORS = new Set([
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
]);

export const DEFAULT_PAGINATION: PaginationConfig = { limit: 10 };

export const DEFAULT_HTML_FORMAT: HtmlFormatConfig = {
  theme: undefined,
  accent: 'lime',
  math: 'none',
  toc: true,
  tocDepth: 6,
  hyphenation: false,
};

export const DEFAULT_PDF_FORMAT: PdfFormatConfig = {
  engine: 'pdflatex',
  concurrency: 2,
  hyphenation: false,
  pdfx: false,
  toc: true,
  tocDepth: 6,
  pageSize: 'letter',
  fontSize: '12pt',
  fontFamily: 'mathptmx',
  margins: ['2.54cm', '2.54cm', '2.54cm', '2.54cm'],
  lineSpacing: 1.5,
  pageNumber: 'header-right',
  sides: 'oneside',
  numbering: false,
  bibliography: 'bibliography.bib',
  csl: 'apa.csl',
};

export const DEFAULT_EPUB_FORMAT: EpubFormatConfig = {
  toc: true,
  tocDepth: 6,
  bibliography: 'bibliography.bib',
  csl: 'apa.csl',
};

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  title: 'iteraciones',
  tagline: 'escribir, compartir, re-existir',
  lang: 'es-MX',
  logo: '',
  baseUrl: undefined,
  plugins: [],
  pagination: DEFAULT_PAGINATION,
  format: {
    html: DEFAULT_HTML_FORMAT,
    pdf: DEFAULT_PDF_FORMAT,
    epub: DEFAULT_EPUB_FORMAT,
  },
};
