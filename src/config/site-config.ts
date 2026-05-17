export interface SiteConfig {
  title: string;
  tagline: string;
  lang: string;
  logo: string;
  listItemsLimit: number;
  plugins: string[];
  theme: string | undefined;
  accent: string;
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
};
