import type { TemplateContext } from '../../template/render/context.js';
import { escapeHtml } from '../html.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';
import { resolveAuthorHref } from './authors.js';

/**
 * Construye el TemplateContext para un documento de tipo `collection`.
 *
 * Variables producidas para `templates/collection.html`:
 *   title         → frontmatter.title del documento colección
 *   author        → frontmatter.author del documento colección
 *   body          → htmlFragment del documento colección (introducción opcional)
 *   list-items    → array de { href, title, author, author-href?, body, date } en el orden editorial de `items:`
 *   count         → número de items en esta página
 *
 * Variables de paginación (presentes si `paginationCtx` se proporciona):
 *   has-pagination  → true cuando hay más de una página
 *   page-number     → número de página actual (base 1)
 *   page-count      → total de páginas
 *   total-items     → total de items en la colección
 *   page-previous   → { href } si existe página anterior, undefined si no
 *   page-next       → { href } si existe página siguiente, undefined si no
 *
 * Precondición: `items` ya han sido resueltos por `resolveCollectionItems` (búsqueda
 * por ruta en el pool) y paginados por `paginateItems`; el orden editorial de `items:`
 * en el frontmatter se preserva sin reordenar por fecha.
 */
export function buildCollectionContext(
  doc: BuildDocument,
  items: BuildDocument[],
  authorIndex?: AuthorDocumentIndex,
  paginationCtx?: Record<string, unknown>,
): TemplateContext {
  const listItems = items.map((item) => {
    const authorHref = resolveAuthorHref(item.frontmatter.author, authorIndex);
    return {
      href: `/${item.relativePath.replace(/\.md$/, '.html')}`,
      title: item.frontmatter.title,
      author: item.frontmatter.author.join(', '),
      'author-href': authorHref,
      body: item.htmlFragment ?? '',
      date: item.frontmatter.date,
    };
  });

  return {
    title: doc.frontmatter.title,
    pagetitle: escapeHtml(doc.frontmatter.title),
    author: doc.frontmatter.author.join(', '),
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    count: listItems.length,
    ...(paginationCtx ?? {}),
  };
}
