import type { TemplateContext } from '../../template/render/context.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';
import { resolveAuthorHref } from './authors.js';

/**
 * Construye el TemplateContext para un documento de tipo `collection`.
 *
 * Variables producidas para `templates/collection.html`:
 *   title        → frontmatter.title del documento colección
 *   author       → frontmatter.author del documento colección
 *   body         → htmlFragment del documento colección (introducción opcional)
 *   list-items   → array de { href, title, author, date } para cada item del índice
 *   count        → número de items
 *
 * Precondición: los `items` ya vienen ordenados y paginados desde `collectByType`.
 */
export function buildCollectionContext(doc: BuildDocument, items: BuildDocument[], authorIndex?: AuthorDocumentIndex): TemplateContext {
  const listItems = items.map((item) => {
    const authorHref = resolveAuthorHref(item.frontmatter.author, authorIndex);
    return {
      href: `/${item.relativePath.replace(/\.md$/, '.html')}`,
      title: item.frontmatter.title,
      author: item.frontmatter.author.join(', '),
      ...(authorHref !== undefined && { 'author-href': authorHref }),
      date: item.frontmatter.date,
    };
  });

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    author: doc.frontmatter.author.join(', '),
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    count: listItems.length,
  };
}
