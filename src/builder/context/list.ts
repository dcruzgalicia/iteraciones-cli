import type { TemplateContext } from '../../template/render/context.js';
import type { BuildDocument } from '../types.js';

/**
 * Construye el TemplateContext para un documento de tipo `list`.
 *
 * Variables producidas para `templates/list.html`:
 *   title      → frontmatter.title del documento lista
 *   pagetitle  → frontmatter.title del documento lista
 *   author     → frontmatter.author del documento lista
 *   body       → htmlFragment del documento lista (introducción opcional)
 *   list-items → array de { href, title, author, body, date } para cada item del índice
 *   count      → número de items
 *
 * Precondición: los `items` ya vienen ordenados y paginados desde `collectByType`.
 * El campo `body` de cada item proviene de `htmlFragment` (disponible si los docs
 * fueron renderizados antes de construir el índice; de lo contrario queda vacío).
 */
export function buildListContext(doc: BuildDocument, items: BuildDocument[]): TemplateContext {
  const listItems = items.map((item) => ({
    href: `/${item.relativePath.replace(/\.md$/, '.html')}`,
    title: item.frontmatter.title,
    author: item.frontmatter.author.join(', '),
    body: item.htmlFragment ?? '',
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
