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
   * Variante de template LaTeX a usar por defecto en todos los documentos exportados a PDF.
   * Puede sobreescribirse a nivel de documento mediante `editorial.template` en el frontmatter.
   *
   * - `'literary'` / `'academic'`: para documentos `scrartcl` (file, event, author).
   * - `'anthology'` / `'technical'`: para documentos `scrbook` (collection, events).
   *
   * Si la variante no es compatible con el `documentclass` del documento se usa el template base.
   */
  template?: 'literary' | 'academic' | 'anthology' | 'technical';
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
