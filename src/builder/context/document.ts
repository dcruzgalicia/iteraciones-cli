import type { TemplateContext } from '../../template/render/context.js';
import { escapeHtml } from '../html.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';
import { resolveAuthorHref } from './authors.js';

/**
 * Construye el subconjunto del TemplateContext que proviene del documento.
 * Sin I/O ni efectos secundarios.
 *
 * Variables producidas:
 *   title            → frontmatter.title (sin escape; para uso en templates de tipo)
 *   pagetitle        → frontmatter.title escapado (para el elemento <title> del HTML)
 *   date             → frontmatter.date
 *   author           → frontmatter.author unido con ', '
 *   author-meta      → frontmatter.author como array escapado (para <meta name="author">)
 *   author-href      → href root-relative del primer autor con página en el índice;
 *                      ausente cuando no hay índice o ningún autor tiene página
 *   keywords         → frontmatter.keywords (array; puede ser vacío)
 *   description-meta → frontmatter['description-meta'] o frontmatter.description escapado;
 *                      ausente si no se define ninguno de los dos campos
 *   date-meta        → frontmatter['date-meta'] o frontmatter.date escapado;
 *                      ausente si el documento no tiene fecha
 *   body             → HTML renderizado
 */
export function buildDocumentContext(doc: BuildDocument, renderedHtml: string, authorIndex?: AuthorDocumentIndex): TemplateContext {
  const authorHref = resolveAuthorHref(doc.frontmatter.author, authorIndex);

  const rawDescriptionMeta = doc.frontmatter['description-meta'] ?? doc.frontmatter.description;
  const descriptionMeta = typeof rawDescriptionMeta === 'string' && rawDescriptionMeta.trim() ? escapeHtml(rawDescriptionMeta.trim()) : undefined;

  const rawDateMeta = doc.frontmatter['date-meta'] ?? doc.frontmatter.date;
  const dateMeta = typeof rawDateMeta === 'string' && rawDateMeta.trim() ? escapeHtml(rawDateMeta.trim()) : undefined;

  return {
    title: doc.frontmatter.title,
    pagetitle: escapeHtml(doc.frontmatter.title),
    date: doc.frontmatter.date,
    author: doc.frontmatter.author.join(', '),
    'author-meta': doc.frontmatter.author.map(escapeHtml).filter(Boolean),
    ...(authorHref !== undefined && { 'author-href': authorHref }),
    keywords: doc.frontmatter.keywords,
    ...(descriptionMeta !== undefined && { 'description-meta': descriptionMeta }),
    ...(dateMeta !== undefined && { 'date-meta': dateMeta }),
    body: renderedHtml,
  };
}
