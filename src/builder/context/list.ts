import type { TemplateContext } from '../../template/render/context.js';
import { escapeHtml } from '../html.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';
import { resolveAuthorHref } from './authors.js';

/**
 * Construye el TemplateContext para un documento de tipo `list`.
 *
 * Variables producidas para `templates/list.html`:
 *   title          → frontmatter.title del documento lista
 *   pagetitle      → frontmatter.title del documento lista
 *   author         → frontmatter.author del documento lista
 *   body           → htmlFragment del documento lista (introducción opcional)
 *   list-items     → array de { href, title, author, body, date, author-href? } para cada item de la página
 *   count          → número de items en la página actual
 *   has-pagination → true cuando hay más de una página (desde paginationCtx)
 *   page-number    → número de página actual, 1-indexed (desde paginationCtx)
 *   page-count     → total de páginas (desde paginationCtx)
 *   total-items    → total de items sin paginar (desde paginationCtx)
 *   page-previous  → { href } de la página anterior, si existe (desde paginationCtx)
 *   page-next      → { href } de la página siguiente, si existe (desde paginationCtx)
 *
 * Precondición: los `items` provienen de una página de `paginateItems(renderedFileDocs, ...)`;
 * `htmlFragment` está disponible en cada item. `paginationCtx` es el resultado de
 * `buildPaginationContext` y se omite cuando hay una sola página.
 */
export function buildListContext(
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
      body: item.htmlFragment ?? '',
      'author-href': authorHref,
      date: item.frontmatter.date,
    };
  });

  const pageAuthorHref = resolveAuthorHref(doc.frontmatter.author, authorIndex);

  return {
    title: doc.frontmatter.title,
    pagetitle: escapeHtml(doc.frontmatter.title),
    author: doc.frontmatter.author.join(', '),
    ...(pageAuthorHref !== undefined && { 'author-href': pageAuthorHref }),
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    count: listItems.length,
    ...paginationCtx,
  };
}
