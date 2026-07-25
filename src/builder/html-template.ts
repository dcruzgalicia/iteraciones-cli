import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface HtmlTemplateVars {
  /** Titulo del documento (frontmatter.title). */
  title: string;
  /** Nombre del sitio (site.title). */
  siteTitle: string;
  /** Tagline del sitio (site.tagline). */
  tagline?: string;
  /** Idioma (site.lang). */
  lang: string;
  /** Ruta al logo (site.logo), ej: /files/logo.svg. */
  logo?: string;
  /** Base URL del sitio (site.baseUrl). */
  baseUrl?: string;
  /** Tema claro/oscuro (format.html.theme). */
  theme?: string;
  /** Color de acento (format.html.accent). */
  accent?: string;
  /** Ruta al CSS de Tailwind, ej: /files/css/styles.css. */
  css?: string;
  /** Autor del documento (frontmatter.author). */
  author?: string[];
  /** Descripcion del documento (frontmatter.abstract o description). */
  description?: string;
}

/** Nombre de variable en template: letras, digitos, guiones, guion bajo. */
const VAR_RE = /[\w-]+/;
const VAR_PATTERN = new RegExp(`\\$(${VAR_RE.source})\\$`, 'g');
const IF_PATTERN = new RegExp(`\\$if\\((${VAR_RE.source})\\)\\$([\\s\\S]*?)\\$endif\\$`, 'g');

/**
 * Parsea un template pandoc HTML y reemplaza las variables.
 * Soporta $variable$ y $if(variable)$...$endif$.
 */
function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  // Reemplazar $if(variable)$...$endif$
  let result = template.replace(IF_PATTERN, (_match: string, name: string, content: string) => {
    const val = vars[name];
    if (val !== undefined && val !== '') {
      return content.replace(VAR_PATTERN, (_m: string, n: string) => vars[n] ?? '');
    }
    return '';
  });

  // Reemplazar variables sueltas
  result = result.replace(VAR_PATTERN, (_match: string, name: string) => {
    return vars[name] ?? '';
  });

  return result;
}

/**
 * Lee el template HTML de pandoc y genera el HTML completo para un documento.
 */
export async function renderHtmlPage(fragment: string, vars: HtmlTemplateVars): Promise<string> {
  const templatePath = join(import.meta.dir, '../../pandoc/template.html');
  const template = await readFile(templatePath, 'utf-8');

  const theme = vars.theme ?? 'dark';
  const accent = vars.accent ?? 'lime';

  // Mapear variables al formato de template pandoc
  const templateVars: Record<string, string | undefined> = {
    body: fragment,
    title: vars.title,
    'site-title': vars.siteTitle,
    tagline: vars.tagline,
    lang: vars.lang,
    logo: vars.logo,
    'base-url': vars.baseUrl ?? '',
    theme: theme,
    accent: accent,
    css: vars.css,
    'author-meta': vars.author?.join(', '),
    'description-meta': vars.description,
  };

  return renderTemplate(template, templateVars);
}
