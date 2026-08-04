export type PageNumberPlacement = 'footer-left' | 'footer-center' | 'footer-right' | 'header-left' | 'header-center' | 'header-right';

// ── Schema `format:` (estilo Quarto) ──

export interface HtmlFormatConfig {
  /** Título del sitio. Se usa en el <title> de cada página HTML. */
  title?: string;
  /** Frase corta que acompaña al título en el encabezado HTML. */
  tagline?: string;
  /** Ruta al logo, relativa al proyecto. */
  logo?: string;
  /** URL base del sitio para el link del encabezado. */
  baseUrl?: string;
  theme?: string;
  accent?: string;
  /** Si true, genera HTML en el build. */
  generate?: boolean;
}

export interface PdfFormatConfig {
  generate?: boolean;

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
  /** Lista de paquetes de fuente a cargar. Cada entrada genera \\usepackage[options]{name}. */
  fontFamily?: Array<{ name: string; options?: string[] }>;
  setspace?: boolean;

  // Active commands
  setstretch?: number;
  raggedbottom?: boolean;
  pretolerance?: number;
  tolerance?: number;
  brokenpenalty?: number;
  hyphenpenalty?: number;
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

  // Sectioning (replaces filters 03-09)
  sectioning?: {
    part?: { beforeskip?: string; afterskip?: string; font?: string; pagestyle?: string };
    chapter?: { style?: string; beforeskip?: string; afterskip?: string; font?: string; align?: string; pagestyle?: string };
    section?: { style?: string; beforeskip?: string; afterskip?: string; font?: string; align?: string; pagestyle?: string };
    subsection?: { beforeskip?: string; afterskip?: string; font?: string; pagestyle?: string };
    subsubsection?: { beforeskip?: string; afterskip?: string; font?: string; pagestyle?: string };
    paragraph?: { beforeskip?: string; afterskip?: string; font?: string; pagestyle?: string };
    subparagraph?: { beforeskip?: string; afterskip?: string; font?: string; pagestyle?: string };
  };

  // setkomafont for maketitle elements (replaces filter 02)
  setkomafont?: {
    title?: string;
    subtitle?: string;
    author?: string;
    date?: string;
    publishers?: string;
  };

  // Dictum (replaces filter 10)
  dictum?: {
    width?: string;
    font?: string;
    rule?: string;
    authorfont?: string;
    authorformat?: string;
  };
}

export interface EpubFormatConfig {
  /** Si true, genera EPUB en el build. */
  generate?: boolean;
}

export interface MarkdownFormatConfig {
  /** Si true, genera Markdown en el build. */
  generate?: boolean;
}

export interface FormatConfig {
  html?: HtmlFormatConfig;
  pdf?: PdfFormatConfig;
  epub?: EpubFormatConfig;
  markdown?: MarkdownFormatConfig;
  /** Si true (default), genera archivos .tex en el output. */
  latex?: boolean;
}

// ── SiteConfig ──

export interface SiteConfig {
  lang: string;
  /** Configuracion por formato de salida. */
  format: FormatConfig;
  /**
   * Lista de filters a desactivar (blacklist), por nombre completo.
   * Por defecto undefined = todos activos.
   * Para desactivar uno, agrega su nombre completo aqui. Ej:
   *   disabled-filters:
   *     - latex/02-dictum
   * Para sobrescribir un filter, crea un archivo con el mismo
   * nombre completo en <proyecto>/filters/<grupo>/<nombre>.lua.
   */
  disabledFilters?: string[];
  /**
   * Lista de preamble filters a desactivar (blacklist).
   * Por defecto undefined = todos activos.
   */
  disabledPreambleFilters?: string[];
  /**
   * Filtros Lua de usuario (rutas relativas al proyecto). Se pasan como
   * `--lua-filter` en TODAS las invocaciones pandoc del documento
   * (markdown→json, json→latex, json→html5, json→epub3, json→markdown).
   * Dentro del filtro, la variable global `FORMAT` permite condicionar por
   * formato de salida (latex, html5, epub3, markdown, json). Ej:
   *   lua-filters:
   *     - filters/mi-filtro.lua
   */
  luaFilters?: string[];
}

/**
 * Colores Tailwind v4 con escala completa 50-950 válidos como acento.
 * Excluye white, black, transparent y similares que no tienen escala.
 */

export const DEFAULT_HTML_FORMAT: HtmlFormatConfig = {
  title: 'iteraciones',
  tagline: 'escribir, compartir, re-existir',
  logo: '',
  baseUrl: undefined,
  theme: undefined,
  accent: 'lime',
  generate: true,
};

export const DEFAULT_PDF_FORMAT: PdfFormatConfig = {
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
  setspace: true,
  setstretch: 1.5,
  raggedbottom: true,
  pretolerance: 200,
  tolerance: 400,
  brokenpenalty: 1_000_000,
  hyphenpenalty: 100,
  finalhyphendemerits: 1_000_000,
  doublehyphendemerits: 1_000_000,
  widowpenalty: 1_000_000,
  clubpenalty: 1_000_000,
  setlist: [{ command: 'description', options: ['noitemsep', 'nosep', 'topsep=\\baselineskip'] }],
  setcounter: { secnumdepth: 1, tocdepth: 1 },
  sectioning: {
    part: { beforeskip: '11\\baselineskip', afterskip: '\\baselineskip', font: '\\normalsize\\bfseries\\MakeUppercase', pagestyle: 'empty' },
    chapter: {
      style: 'chapter',
      beforeskip: '2\\baselineskip',
      afterskip: '\\baselineskip',
      font: '\\normalsize\\normalfont\\scshape',
      align: 'center',
      pagestyle: 'plain',
    },
    section: {
      style: 'section',
      beforeskip: '2\\baselineskip',
      afterskip: '2\\baselineskip',
      font: '\\normalsize\\bfseries\\MakeUppercase',
      align: 'center',
      pagestyle: 'plain',
    },
    subsection: { beforeskip: '2\\baselineskip', afterskip: '2\\baselineskip', font: '\\normalsize\\normalfont\\textit', pagestyle: 'plain' },
    subsubsection: { beforeskip: '2\\baselineskip', afterskip: '\\baselineskip', font: '\\normalsize\\normalfont\\itshape', pagestyle: 'plain' },
    paragraph: { beforeskip: '\\baselineskip', afterskip: '0pt', font: '\\normalsize\\normalfont', pagestyle: 'plain' },
    subparagraph: { beforeskip: '\\baselineskip', afterskip: '0pt', font: '\\normalsize\\normalfont', pagestyle: 'plain' },
  },
  setkomafont: {
    title: '\\normalsize\\bfseries',
    subtitle: '\\normalsize\\normalfont\\itshape',
    author: '\\normalsize\\normalfont\\scshape',
    date: '\\normalsize\\normalfont',
    publishers: '\\normalsize\\normalfont',
  },
  dictum: {
    width: '0.5\\textwidth',
    font: '\\normalsize\\normalfont\\itshape',
    rule: '',
    authorfont: '\\normalsize\\normalfont',
    authorformat: '#1',
  },
  esoPic: false,
  pdfx: false,
  crop: false,
  pageNumber: 'header-right',
  toc: false,
  showDate: false,
  generate: false,
};

export const DEFAULT_EPUB_FORMAT: EpubFormatConfig = {
  generate: false,
};

export const DEFAULT_MARKDOWN_FORMAT: MarkdownFormatConfig = {
  generate: false,
};

/**
 * Extrae los nombres de formatos activos desde FormatConfig.
 */
export function computeActiveFormats(format: FormatConfig): string[] {
  const formats: string[] = [];
  if (format.latex === true) formats.push('latex');
  if (format.pdf?.generate === true) formats.push('pdf');
  if (format.html?.generate === true) formats.push('html');
  if (format.epub?.generate === true) formats.push('epub');
  if (format.markdown?.generate === true) formats.push('markdown');
  return formats;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  lang: 'es-MX',
  disabledFilters: undefined,
  disabledPreambleFilters: undefined,
  luaFilters: undefined,
  format: {
    html: DEFAULT_HTML_FORMAT,
    pdf: DEFAULT_PDF_FORMAT,
    epub: DEFAULT_EPUB_FORMAT,
    markdown: DEFAULT_MARKDOWN_FORMAT,
    latex: false,
  },
};
