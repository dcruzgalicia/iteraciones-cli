export interface SiteConfig {
  title: string;
  tagline: string;
  lang: string;
  logo: string;
  listItemsLimit: number;
  plugins: string[];
  theme: string | undefined;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  title: 'Iteraciones',
  tagline: 'escribir, compartir, re-existir',
  lang: 'es',
  logo: '',
  listItemsLimit: 10,
  plugins: [],
  theme: undefined,
};
