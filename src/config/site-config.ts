export type PageSize = 'half-letter' | 'letter' | 'legal' | 'executive' | 'a3' | 'a4' | 'a5' | 'b4' | 'b5' | 'tabloid' | 'pocket' | (string & {});

export type PageNumberPlacement = 'footer-left' | 'footer-center' | 'footer-right' | 'header-left' | 'header-center' | 'header-right';

export type Sides = 'oneside' | 'twoside';

export interface ExportHyphenationConfig {
  html: boolean;
  pdf: boolean;
}

/**
 * Configuración de layout para un formato de exportación (PDF, EPUB, HTML).
 */
export interface FormatLayout {
  /** Tamaño de página (solo PDF). */
  pageSize?: PageSize;
  /** Tamaño de fuente base (ej: `11pt`, `12pt`). */
  fontSize?: string;
  /** Familia tipográfica (nombre del font como en fontspec). */
  fontFamily?: string;
  /** Márgenes como [top, right, bottom, left] en unidades LaTeX (ej: `2.5cm`). */
  margins?: [string, string, string, string];
  /** Interlineado (factor pasado a setstretch). */
  lineSpacing?: number;
  /** Si se muestran números de capítulo/sección. */
  numbering?: boolean;
  /** Posición del número de página (header/footer + alineación). */
  pageNumber?: PageNumberPlacement;
  /** Caras del documento: una cara (oneside) o doble cara (twoside). */
  sides?: Sides;
  /** Incluir índice de contenidos (true/false). Si no se especifica, se deriva de tocDepth o del documentclass. */
  toc?: boolean;
  /** Profundidad del índice de contenidos (0 = sin índice, 1-5 = niveles). */
  tocDepth?: number;
}

export interface LayoutConfig {
  pdf?: FormatLayout;
  html?: Partial<FormatLayout>;
  epub?: Partial<FormatLayout>;
}

/**
 * Configuración de exportación editorial (PDF y EPUB) definida en `_iteraciones.yaml`
 * bajo la clave `export:`.
 */
export interface ExportConfig {
  /** Formatos a generar en cada build. */
  formats: ReadonlyArray<'pdf' | 'epub'>;
  /** Motor LaTeX para PDF. Por defecto `xelatex`. */
  pdfEngine: 'xelatex' | 'lualatex';
  /**
   * Ruta al archivo `.bib` global (relativa o absoluta; debe quedar dentro del proyecto).
   * Se usa como fallback cuando el frontmatter de un documento no define `editorial.bibliography`.
   */
  bibliography?: string;
  /**
   * Ruta al archivo `.csl` global para citas bibliográficas.
   * Se usa como fallback cuando el frontmatter de un documento no define `editorial.csl`.
   */
  csl?: string;
  /**
   * Número máximo de documentos que se exportan a PDF en paralelo.
   * xelatex no es thread-safe y consume memoria significativa (~300-600 MB/instancia);
   * un valor alto puede saturar el sistema en sitios con muchos documentos exportables.
   * Por defecto: `2`. Rango recomendado: 1–4.
   */
  pdfConcurrency: number;
  /** Control de guiones (hyphenation) para PDF y HTML. */
  hyphenation?: ExportHyphenationConfig;
  /** Configuración de layout editorial por formato. */
  layout?: LayoutConfig;
}

export interface SiteConfig {
  title: string;
  tagline: string;
  lang: string;
  logo: string;
  listItemsLimit: number;
  plugins: string[];
  theme: string | undefined;
  accent: string;
  /** URL base del sitio publicado, p. ej. `https://ejemplo.com`. Opcional. */
  baseUrl: string | undefined;
  /** Configuración de exportación PDF/EPUB. `undefined` si no se configuró. */
  export: ExportConfig | undefined;
  /**
   * Motor de matemáticas para la salida HTML. `undefined` si no se configuró.
   * - `'katex'`: carga KaTeX vía CDN (recomendado, más rápido).
   * - `'mathjax'`: carga MathJax vía CDN (mayor compatibilidad).
   */
  math: 'katex' | 'mathjax' | undefined;
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

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  title: 'Iteraciones',
  tagline: 'escribir, compartir, re-existir',
  lang: 'es',
  logo: '',
  listItemsLimit: 10,
  plugins: [],
  theme: undefined,
  accent: 'lime',
  baseUrl: undefined,
  export: undefined,
  math: undefined,
};
