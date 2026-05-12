import { join } from 'node:path';
import { ConfigError } from '../errors.js';
import { DEFAULT_SITE_CONFIG, type SiteConfig } from './site-config.js';

const CONFIG_FILE = '_iteraciones.yaml';

export async function loadSiteConfig(cwd: string): Promise<SiteConfig> {
  const configPath = join(cwd, CONFIG_FILE);
  const file = Bun.file(configPath);

  if (!(await file.exists())) return { ...DEFAULT_SITE_CONFIG, plugins: [...DEFAULT_SITE_CONFIG.plugins] };

  let raw: string;
  try {
    raw = await file.text();
  } catch (err) {
    throw new ConfigError(`No se pudo leer ${CONFIG_FILE}: ${String(err)}`, configPath);
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (err) {
    throw new ConfigError(`Error de sintaxis en ${CONFIG_FILE}: ${String(err)}`, configPath);
  }

  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SITE_CONFIG, plugins: [...DEFAULT_SITE_CONFIG.plugins] };

  const root = parsed as Record<string, unknown>;
  const site = root.site && typeof root.site === 'object' ? (root.site as Record<string, unknown>) : {};
  const listItems = site['list-items'] && typeof site['list-items'] === 'object' ? (site['list-items'] as Record<string, unknown>) : {};

  const plugins = Array.isArray(root.plugins) ? root.plugins.filter((p): p is string => typeof p === 'string') : [...DEFAULT_SITE_CONFIG.plugins];

  const rawLimit = listItems.limit;
  const listItemsLimit =
    typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_SITE_CONFIG.listItemsLimit;

  return {
    title: typeof site.title === 'string' ? site.title : DEFAULT_SITE_CONFIG.title,
    tagline: typeof site.tagline === 'string' ? site.tagline : DEFAULT_SITE_CONFIG.tagline,
    lang: typeof site.lang === 'string' ? site.lang : DEFAULT_SITE_CONFIG.lang,
    logo: typeof site.logo === 'string' ? site.logo : DEFAULT_SITE_CONFIG.logo,
    listItemsLimit,
    plugins,
    theme: typeof root.theme === 'string' ? root.theme : DEFAULT_SITE_CONFIG.theme,
  };
}
