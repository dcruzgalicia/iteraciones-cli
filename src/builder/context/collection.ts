import type { TemplateContext } from '../../template/render/context.js';
import type { BuildDocument } from '../types.js';

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
export function buildCollectionContext(doc: BuildDocument, items: BuildDocument[]): TemplateContext {
  const listItems = items.map((item) => ({
    href: `/${item.relativePath.replace(/\.md$/, '.html')}`,
    title: item.frontmatter.title,
    author: item.frontmatter.author.join(', '),
    date: item.frontmatter.date,
  }));

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    author: doc.frontmatter.author.join(', '),
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    count: listItems.length,
  };
}
