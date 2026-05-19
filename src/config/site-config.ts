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
   * Ruta al archivo `.bib` global (relativa al cwd del proyecto).
   * Se usa como fallback cuando el frontmatter de un documento no define `editorial.bibliography`.
   */
  bibliography?: string;
  /**
   * Ruta al archivo `.csl` global para citas bibliográficas.
   * Se usa como fallback cuando el frontmatter de un documento no define `editorial.csl`.
   */
  csl?: string;
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
};
