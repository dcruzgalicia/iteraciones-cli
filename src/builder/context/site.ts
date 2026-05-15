import type { SiteConfig } from '../../config/site-config.js';
import type { TemplateContext } from '../../template/render/context.js';

/**
 * Construye el subconjunto del TemplateContext que proviene de la configuración
 * del sitio. Sin I/O ni efectos secundarios.
 *
 * Variables producidas:
 *   site-title    → config.title
 *   site-tagline  → config.tagline
 *   lang          → config.lang
 *   site-logo     → `/${config.logo}` normalizado como ruta root-relative,
 *                   o undefined si config.logo no está definido
 *   css           → [cssPath] si cssPath no está vacío, [] si lo está
 */
export function buildSiteContext(config: SiteConfig, cssPath: string): TemplateContext {
  return {
    'site-title': config.title,
    'site-tagline': config.tagline,
    lang: config.lang,
    'site-logo': config.logo ? `/${config.logo.replace(/^\/+/, '')}` : undefined,
    css: cssPath ? [cssPath] : [],
  };
}
