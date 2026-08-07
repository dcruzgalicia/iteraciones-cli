// ── Schema `format:` (estilo Quarto) ──

export interface HtmlFormatConfig {
  /** Título del sitio. Se usa en el <title> de cada página HTML. */
  title?: string;
  /** Frase corta que acompaña al título en el encabezado HTML. */
  tagline?: string;
  /** Ruta al logo, relativa al proyecto. */
  logo?: string;
  theme?: string;
  accent?: string;
  /** Si true, genera HTML en el build. */
  generate?: boolean;
}

export interface PdfFormatConfig {
  /** Si true, genera PDF mediante latexmk. */
  generate?: boolean;
  /** Incluye tabla de contenidos en el PDF. */
  toc?: boolean;
  /** Muestra la fecha en la portada del PDF. */
  showDate?: boolean;
  /** Posición del número de página: footer-left|center|right, header-left|center|right. */
  pageNumber?: string;
  /**
   * Lista de preamble filters a desactivar (blacklist).
   * Por defecto undefined = todos activos.
   */
  disabledPreambleFilters?: string[];
}

interface EpubFormatConfig {
  /** Si true, genera EPUB en el build. */
  generate?: boolean;
}

interface MarkdownFormatConfig {
  /** Si true, genera Markdown en el build. */
  generate?: boolean;
}

export interface FormatConfig {
  html?: HtmlFormatConfig;
  pdf?: PdfFormatConfig;
  epub?: EpubFormatConfig;
  markdown?: MarkdownFormatConfig;
  /** Si true (por defecto: false), genera archivos .tex en el output. */
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
  theme: undefined,
  accent: 'lime',
  generate: true,
};

export const DEFAULT_PDF_FORMAT: PdfFormatConfig = {
  generate: false,
  toc: false,
  showDate: false,
  pageNumber: 'header-right',
  disabledPreambleFilters: ['24-eso-pic', '25-pdfx', '26-crop'],
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
  luaFilters: undefined,
  format: {
    html: DEFAULT_HTML_FORMAT,
    pdf: DEFAULT_PDF_FORMAT,
    epub: DEFAULT_EPUB_FORMAT,
    markdown: DEFAULT_MARKDOWN_FORMAT,
    latex: false,
  },
};
