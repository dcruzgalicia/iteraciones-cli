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
  /**
   * Genera thumbnails JPG de la primera pagina del PDF.
   * - false: no generar
   * - true: generar un solo JPG de 1200px (OG image)
   'responsive': generar sm (320), md (640), lg (1200), xl (2400)
*/
  thumbnails?: ThumbnailMode;
}

/** Controla la eliminacion de PDF tras generar thumbnails. */
export type PdfForceMode = boolean;

export interface PdfFormatConfig {
  concurrency: number;
  generate?: boolean;
  force?: boolean;

  // Class
  documentclass?: {
    class?: 'scrartcl' | 'scrbook';
    options?: string[];
  };

  // Active packages (with options)
  geometry?: { options?: string[] };
  babel?: { options?: string[] };
  hyperref?: { options?: string[] };
  microtype?: { options?: string[] };
  enumitem?: boolean;
  mathptmx?: boolean;
  setspace?: boolean;

  // Active commands
  setstretch?: number;
  raggedbottom?: boolean;
  pretolerance?: number;
  tolerance?: number;
  brokenpenalty?: number;
  finalhyphendemerits?: number;
  doublehyphendemerits?: number;
  widowpenalty?: number;
  clubpenalty?: number;
  setlist?: Array<{ command: string; options: string[] }>;
  setcounter?: Record<string, number>;

  // Optional packages
  esoPic?: { options?: string[] } | boolean;
  pdfx?: boolean;
  crop?: boolean;

  // Other attributes
  pageNumber?: PageNumberPlacement;
  toc?: boolean;
  showDate?: boolean;

  // Sectioning (replaces transpilers 03-09)
  sectioning?: {
    part?: { beforeskip?: string; afterskip?: string; font?: string };
    chapter?: { style?: string; beforeskip?: string; afterskip?: string; font?: string; align?: string };
    section?: { style?: string; beforeskip?: string; afterskip?: string; font?: string; align?: string };
    subsection?: { beforeskip?: string; afterskip?: string; font?: string };
    subsubsection?: { beforeskip?: string; afterskip?: string; font?: string };
    paragraph?: { beforeskip?: string; afterskip?: string; font?: string };
    subparagraph?: { beforeskip?: string; afterskip?: string; font?: string };
  };

  // setkomafont for maketitle elements (replaces transpiler 02)
  setkomafont?: {
    title?: string;
    subtitle?: string;
    author?: string;
    publishers?: string;
  };

  // Dictum (replaces transpiler 10)
  dictum?: {
    width?: string;
    font?: string;
    rule?: string;
    authorfont?: string;
    authorformat?: string;
  };

  // Page style (replaces transpiler 12)
  pagestyle?: {
    part?: string;
    chapter?: string;
  };
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
  /**
   * Lista de preamble transpilers a desactivar (blacklist).
   * Por defecto undefined = todos activos.
   */
  disabledPreambleTranspilers?: string[];
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
  thumbnails: false,
};

export const DEFAULT_PDF_FORMAT: PdfFormatConfig = {
  concurrency: detectConcurrency(),
  documentclass: {
    class: 'scrbook',
    options: ['12pt', 'sfdefaults=false', 'paper=letter', 'twoside'],
  },
  geometry: { options: ['top=2.54cm', 'bottom=2.54cm', 'left=2.54cm', 'right=2.54cm', 'headheight=\\baselineskip', 'headsep=6pt', 'footskip=22pt'] },
  babel: { options: ['spanish', 'mexico', 'es-noshorthands', 'es-noindentfirst'] },
  hyperref: { options: ['hidelinks'] },
  microtype: {
    options: ['activate={true,nocompatibility}', 'final', 'tracking=true', 'kerning=true', 'spacing=true', 'factor=1100', 'stretch=10', 'shrink=10'],
  },
  enumitem: true,
  mathptmx: true,
  setspace: true,
  setstretch: 1.5,
  raggedbottom: true,
  pretolerance: 200,
  tolerance: 400,
  brokenpenalty: 1_000_000,
  finalhyphendemerits: 1_000_000,
  doublehyphendemerits: 1_000_000,
  widowpenalty: 1_000_000,
  clubpenalty: 1_000_000,
  setlist: [{ command: 'description', options: ['noitemsep', 'nosep', 'topsep=\\baselineskip'] }],
  setcounter: { secnumdepth: 1, tocdepth: 1 },
  sectioning: {
    part: { beforeskip: '11\\baselineskip', afterskip: '\\baselineskip', font: '\\normalsize\\bfseries\\MakeUppercase' },
    chapter: {
      style: 'chapter',
      beforeskip: '2\\baselineskip',
      afterskip: '\\baselineskip',
      font: '\\normalsize\\normalfont\\scshape',
      align: 'center',
    },
    section: {
      style: 'section',
      beforeskip: '2\\baselineskip',
      afterskip: '2\\baselineskip',
      font: '\\normalsize\\bfseries\\MakeUppercase',
      align: 'center',
    },
    subsection: { beforeskip: '2\\baselineskip', afterskip: '2\\baselineskip', font: '\\normalsize\\normalfont\\textit' },
    subsubsection: { beforeskip: '2\\baselineskip', afterskip: '\\baselineskip', font: '\\normalsize\\normalfont\\itshape' },
    paragraph: { beforeskip: '\\baselineskip', afterskip: '0pt', font: '\\normalsize\\normalfont' },
    subparagraph: { beforeskip: '\\baselineskip', afterskip: '0pt', font: '\\normalsize\\normalfont' },
  },
  setkomafont: {
    title: '\\normalsize\\bfseries',
    subtitle: '\\normalsize\\normalfont\\itshape',
    author: '\\normalsize\\normalfont',
    publishers: '\\normalsize\\normalfont',
  },
  dictum: {
    width: '0.5\\textwidth',
    font: '\\normalsize\\normalfont\\itshape',
    rule: '',
    authorfont: '\\normalsize\\normalfont',
    authorformat: '#1\\vspace*{32pt}',
  },
  pagestyle: {
    part: 'empty',
    chapter: 'empty',
  },
  esoPic: false,
  pdfx: false,
  crop: false,
  pageNumber: 'header-right',
  toc: false,
  showDate: false,
  generate: false,
  force: false,
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
  disabledPreambleTranspilers: undefined,
  pagination: DEFAULT_PAGINATION,
  format: {
    html: DEFAULT_HTML_FORMAT,
    pdf: DEFAULT_PDF_FORMAT,
    epub: DEFAULT_EPUB_FORMAT,
    markdown: DEFAULT_MARKDOWN_FORMAT,
    latex: DEFAULT_LATEX_FORMAT,
  },
};
