export type PageSize = 'half-letter' | 'letter' | 'legal' | 'executive' | 'a3' | 'a4' | 'a5' | 'b4' | 'b5' | 'tabloid' | 'pocket' | (string & {});

export type PageNumberPlacement = 'footer-left' | 'footer-center' | 'footer-right' | 'header-left' | 'header-center' | 'header-right';

export type Sides = 'oneside' | 'twoside';

export type ThumbnailMode = boolean | 'responsive';

import { cpus } from 'node:os';

/** Detecta concurrencia automatica: deja un nucleo libre. */
function detectConcurrency(): number {
  return Math.max(1, cpus().length - 1);
}

export const THUMBNAIL_SIZES: Record<string, number> = {
  sm: 320,
  md: 640,
  lg: 1200,
  xl: 2400,
} as const;

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
  /** Si true, genera HTML en el build. */
  generate?: boolean;
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
  /**
   * Opciones para el paquete geometry de LaTeX.
   * Mapa con valores como 'top', 'bottom', 'left', 'right',
   * 'headheight', 'headsep', 'footskip'.
   */
  geometry?: Record<string, string>;
  lineSpacing?: number;
  pageNumber?: PageNumberPlacement;
  sides?: Sides;
  documentclass?: 'scrartcl' | 'scrbook';
  sfdefaults?: boolean;
  /**
   * Cuando es true, el estilo plain (usado en primera pagina de contenido
   * y paginas de section) respeta la posicion header configurada en
   * page-number, en lugar de usar footer-center.
   * Solo aplica cuando page-number es header-*. Por defecto false.
   */
  respectHeaderPlain?: boolean;
  /** Si true, incluye marcas de corte con el paquete crop. */
  crop?: boolean;
  /** Si true, incluye \usepackage[grid]{eso-pic} para cuadricula de fondo. */
  esoPic?: boolean;
  /** Si true, genera PDF en el build. */
  generate?: boolean;
  /**
   * Modo de generacion de thumbnails del PDF:
   * - false: no generar
   * - true: generar un solo JPG de 1200px (estandar Open Graph)
   * - 'responsive': generar sm (320), md (640), lg (1200), xl (2400)
   */
  thumbnails?: ThumbnailMode;
}

export interface EpubFormatConfig {
  toc?: boolean;
  tocDepth?: number;
  bibliography?: string;
  csl?: string;
  /** Si true, genera EPUB en el build. */
  generate?: boolean;
}

export interface MarkdownFormatConfig {
  /** Si true, genera Markdown en el build. */
  generate?: boolean;
}

export interface LatexFormatConfig {
  /** Si true, genera LaTeX (.tex) en el build. */
  generate?: boolean;
  /**
   * Si false (default): cuando pdf.generate=true, latex.generate se trata como true
   * aunque este configurado como false (el PDF necesita el .tex).
   * Si true: respeta el valor exacto de generate.
   */
  force?: boolean;
}

export interface FormatConfig {
  html?: HtmlFormatConfig;
  pdf?: PdfFormatConfig;
  epub?: EpubFormatConfig;
  markdown?: MarkdownFormatConfig;
  latex?: LatexFormatConfig;
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
  /**
   * Lista de transpilers a desactivar (blacklist).
   * Por defecto undefined = todos activos.
   * Para desactivar uno, agrega su nombre aqui. Ej:
   *   disabled-transpilers:
   *     - 01-double-colon
   * Para sobrescribir un transpiler, crea un archivo con el mismo
   * nombre en <proyecto>/transpilers/<nombre>.ts.
   */
  disabledTranspilers?: string[];
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
  generate: false,
};

export const DEFAULT_PDF_FORMAT: PdfFormatConfig = {
  engine: 'pdflatex',
  concurrency: detectConcurrency(),
  hyphenation: false,
  pdfx: false,
  toc: true,
  tocDepth: 6,
  pageSize: 'letter',
  fontSize: '12pt',
  fontFamily: 'mathptmx',
  geometry: {
    top: '2.54cm',
    bottom: '2.54cm',
    left: '2.54cm',
    right: '2.54cm',
    headheight: '12pt',
    headsep: '6pt',
    footskip: '22pt',
  },
  lineSpacing: 1.5,
  pageNumber: 'header-right',
  sides: 'twoside',
  numbering: false,
  bibliography: 'bibliography.bib',
  csl: 'apa.csl',
  generate: false,
  crop: false,
  esoPic: false,
  thumbnails: false,
};

export const DEFAULT_EPUB_FORMAT: EpubFormatConfig = {
  toc: true,
  tocDepth: 6,
  bibliography: 'bibliography.bib',
  csl: 'apa.csl',
  generate: false,
};

export const DEFAULT_MARKDOWN_FORMAT: MarkdownFormatConfig = {
  generate: false,
};

export const DEFAULT_LATEX_FORMAT: LatexFormatConfig = {
  generate: true,
  force: false,
};

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  title: 'iteraciones',
  tagline: 'escribir, compartir, re-existir',
  lang: 'es-MX',
  logo: '',
  baseUrl: undefined,
  plugins: [],
  disabledTranspilers: undefined,
  pagination: DEFAULT_PAGINATION,
  format: {
    html: DEFAULT_HTML_FORMAT,
    pdf: DEFAULT_PDF_FORMAT,
    epub: DEFAULT_EPUB_FORMAT,
    markdown: DEFAULT_MARKDOWN_FORMAT,
    latex: DEFAULT_LATEX_FORMAT,
  },
};
