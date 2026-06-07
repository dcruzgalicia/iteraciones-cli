import type { SiteConfig } from '../../config/site-config.js';
import type { TemplateContext } from '../../template/render/context.js';

// Snippets de CDN para motores de matemáticas.
// KaTeX auto-render: procesa todos los elementos con class "math inline"/"math display"
// generados por pandoc al convertir expresiones $...$ y $$...$$.
const KATEX_CDN =
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css" crossorigin="anonymous">' +
  '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js" crossorigin="anonymous"></script>' +
  '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/contrib/auto-render.min.js" crossorigin="anonymous" ' +
  "onload=\"renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\\\(',right:'\\\\)',display:false},{left:'\\\\[',right:'\\\\]',display:true}]})\"></script>";

const MATHJAX_CDN =
  "<script>window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$'],['\\\\[','\\\\]']],processEscapes:true}};</script>" +
  '<script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" crossorigin="anonymous"></script>';

/**
 * Construye el subconjunto del TemplateContext que proviene de la configuración
 * del sitio. Sin I/O ni efectos secundarios.
 *
 * Variables producidas:
 *   site-title        → config.title
 *   site-tagline      → config.tagline
 *   lang              → config.lang
 *   site-logo         → `/${config.logo}` normalizado como ruta root-relative,
 *                       o undefined si config.logo no está definido
 *   css               → [cssPath] si cssPath no está vacío, [] si lo está
 *   home-href         → '/index.html' (root-relative; se relativiza por documento en el orchestrator)
 *   math              → snippet HTML del CDN de KaTeX o MathJax, segun format.html.math
 *   hyphenation-class → 'hyphens-auto' si format.html.hyphenation es true
 *                       undefined en caso contrario
 */
export function buildSiteContext(config: SiteConfig, cssPath: string): TemplateContext {
  const htmlFormat = config.format?.html;
  const math = htmlFormat?.math === 'katex' ? KATEX_CDN : htmlFormat?.math === 'mathjax' ? MATHJAX_CDN : undefined;
  return {
    'site-title': config.title,
    'site-tagline': config.tagline,
    lang: config.lang,
    'site-logo': config.logo ? `/${config.logo.replace(/^\/+/, '')}` : undefined,
    css: cssPath ? [cssPath] : [],
    'home-href': '/index.html',
    'site-base-url': config.baseUrl,
    math,
    ...(htmlFormat?.hyphenation ? { 'hyphenation-class': 'hyphens-auto' } : {}),
  };
}
