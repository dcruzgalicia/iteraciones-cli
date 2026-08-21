// ── Schema `format:` (estilo Quarto) ──

/** Claves de los bloques del masonry HTML, en su orden por defecto. */
export const DEFAULT_HTML_BLOCKS = ['header', 'contenido', 'formatos', 'indice', 'referencias', 'footer'] as const;

export type HtmlBlockKey = (typeof DEFAULT_HTML_BLOCKS)[number];

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
  /**
   * Orden de los bloques del masonry: la posición en la lista ES el orden
   * (los bloques ausentes no se renderizan). Sin configurar, se usa
   * DEFAULT_HTML_BLOCKS.
   */
  blocks?: HtmlBlockKey[];
}

export interface PdfFormatConfig {
  /** Si true, genera PDF mediante latexmk. */
  generate?: boolean;
  /** Muestra la fecha en la portada del PDF. */
  showDate?: boolean;
  /** Posición del número de página: footer-left|center|right, header-left|center|right. */
  pageNumber?: string;
  /**
   * Lista de preamble filters a desactivar (blacklist).
   * Por defecto undefined = todos activos.
   */
  disabledPreambleFilters?: string[];
  /**
   * Si true, genera junto a cada PDF una imagen PNG de su primera página
   * (portada) usando pdftoppm. La imagen es un extra: un pdftoppm ausente
   * se advierte y no bloquea el PDF.
   */
  coverImage?: boolean;
}

export interface LatexFormatConfig {
  /** Si true, genera archivos .tex en el output. */
  generate?: boolean;
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
  /** Si true (por defecto: false), genera archivos .tex en el output. */
  latex?: LatexFormatConfig;
}

// ── SiteConfig ──
// El tipo SiteConfig se deriva del schema Zod en config-schema.ts:
//   export type SiteConfig = z.infer<typeof SiteConfigSchema>
// La interfaz manual ya no existe aquí. Las sub-interfaces
// (HtmlFormatConfig, PdfFormatConfig, etc.) se conservan para
// que los DEFAULT_* usen satisfies y para los casts del transform.

/**
 * Colores Tailwind v4 con escala completa 50-950 válidos como acento.
 * Excluye white, black, transparent y similares que no tienen escala.
 */

// Los DEFAULT_* son la única fuente de verdad de los valores por defecto:
// el esquema Zod (config-schema.ts) los consume con .default() y el
// transform usa los mismos objetos como fallback. `satisfies` conserva los
// tipos concretos (p. ej. theme: undefined, accent literal) para que el
// esquema pueda leerlos sin fallbacks adicionales.
export const DEFAULT_HTML_FORMAT = {
  title: 'iteraciones',
  tagline: 'escribir, compartir, re-existir',
  logo: '',
  theme: 'dark' as const,
  accent: 'lime' as const,
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
} satisfies PdfFormatConfig;

export const DEFAULT_EPUB_FORMAT = {
  generate: false,
} satisfies EpubFormatConfig;

export const DEFAULT_MARKDOWN_FORMAT = {
  generate: false,
} satisfies MarkdownFormatConfig;

/**
 * Extrae los nombres de formatos activos desde FormatConfig.
 */
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
  format: {
    html: DEFAULT_HTML_FORMAT,
    pdf: DEFAULT_PDF_FORMAT,
    epub: DEFAULT_EPUB_FORMAT,
    markdown: DEFAULT_MARKDOWN_FORMAT,
    latex: DEFAULT_LATEX_FORMAT,
  },
};

/** Claves de los 5 formatos soportados. */
export type FormatKey = 'latex' | 'pdf' | 'html' | 'epub' | 'markdown';

/** Mapa canónico de formatos activos (true = activo). */
export type ActiveFormats = Record<FormatKey, boolean>;

/** Convierte una lista de formatos activos (computeActiveFormats) al mapa canónico. */
export function toActiveFormats(formats: FormatKey[]): ActiveFormats {
  return {
    latex: formats.includes('latex'),
    pdf: formats.includes('pdf'),
    html: formats.includes('html'),
    epub: formats.includes('epub'),
    markdown: formats.includes('markdown'),
  };
}
