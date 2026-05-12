import { join } from 'node:path';
import { ConfigError } from '../errors.js';
import { DEFAULT_SITE_CONFIG, type SiteConfig } from './site-config.js';

const CONFIG_FILE = '_iteraciones.yaml';

export async function loadSiteConfig(cwd: string): Promise<SiteConfig> {
  const configPath = join(cwd, CONFIG_FILE);
  const file = Bun.file(configPath);

  if (!(await file.exists())) return { ...DEFAULT_SITE_CONFIG };

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

  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SITE_CONFIG };

  const root = parsed as Record<string, unknown>;
  const site = root.site;

  if (!site || typeof site !== 'object') return { ...DEFAULT_SITE_CONFIG };

  const s = site as Record<string, unknown>;
  const listItems = s['list-items'] && typeof s['list-items'] === 'object' ? (s['list-items'] as Record<string, unknown>) : {};

  const plugins = Array.isArray(root.plugins) ? root.plugins.filter((p): p is string => typeof p === 'string') : DEFAULT_SITE_CONFIG.plugins;

  return {
    title: typeof s.title === 'string' ? s.title : DEFAULT_SITE_CONFIG.title,
    tagline: typeof s.tagline === 'string' ? s.tagline : DEFAULT_SITE_CONFIG.tagline,
    lang: typeof s.lang === 'string' ? s.lang : DEFAULT_SITE_CONFIG.lang,
    logo: typeof s.logo === 'string' ? s.logo : DEFAULT_SITE_CONFIG.logo,
    listItemsLimit: typeof listItems.limit === 'number' ? listItems.limit : DEFAULT_SITE_CONFIG.listItemsLimit,
    plugins,
    theme: typeof root.theme === 'string' ? root.theme : DEFAULT_SITE_CONFIG.theme,
  };
}
