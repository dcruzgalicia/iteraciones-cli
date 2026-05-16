import type { TemplateContext } from '../../template/render/context.js';
import { escapeHtml } from '../html.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';
import { resolveAuthorHref } from './authors.js';

/**
 * Construye el TemplateContext para un documento de tipo `list`.
 *
 * Variables producidas para `templates/list.html`:
 *   title      → frontmatter.title del documento lista
 *   pagetitle  → frontmatter.title del documento lista
 *   author     → frontmatter.author del documento lista
 *   body       → htmlFragment del documento lista (introducción opcional)
 *   list-items → array de { href, title, author, body, date, author-href? } para cada item del índice
 *   count      → número de items
 *
 * Precondición: los `items` provienen de `renderedFileDocs` (todos los docs de tipo
 * `file` ya renderizados), por lo que `htmlFragment` está disponible en cada item.
 * El listado no aplica `listItemsLimit`; incluye todos los documentos de tipo `file`.
 */
export function buildListContext(doc: BuildDocument, items: BuildDocument[], authorIndex?: AuthorDocumentIndex): TemplateContext {
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
  };
}
