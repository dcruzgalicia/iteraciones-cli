import type { TemplateContext } from '../../template/render/context.js';
import { escapeHtml } from '../html.js';
import { renderMarkdownInline } from '../markdown.js';
import { docHref } from '../slug.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';
import { resolveAuthorHref } from './authors.js';

/**
 * Construye el TemplateContext para un documento de tipo `feed`.
 *
 * Variables producidas para `templates/feed.html`:
 *   title        → frontmatter.title del documento feed
 *   pagetitle    → frontmatter.title del documento feed (HTML-escaped)
 *   author       → frontmatter.author del documento feed
 *   author-href  → href del perfil del autor, si existe
 *   body         → htmlFragment del documento feed (introducción opcional)
 *   feed-items   → array de { href, title, author, author-href?, body, date } para cada item
 *   count        → número de items mostrados
 *
 * A diferencia de `buildListContext`, no acepta `paginationCtx` ya que
 * los documentos feed nunca se paginan.
 */
export function buildFeedContext(doc: BuildDocument, items: BuildDocument[], authorIndex?: AuthorDocumentIndex): TemplateContext {
  const feedItems = items.map((item) => {
    const authorHref = resolveAuthorHref(item.frontmatter.author, authorIndex);
    return {
      href: docHref(item),
      title: item.frontmatter.title,
      'title-html': renderMarkdownInline(item.frontmatter.title),
      author: item.frontmatter.author.join(', '),
      body: item.htmlFragment ?? '',
      'author-href': authorHref,
      date: item.frontmatter.date,
    };
  });

  const pageAuthorHref = resolveAuthorHref(doc.frontmatter.author, authorIndex);

  return {
    title: doc.frontmatter.title,
    'title-html': renderMarkdownInline(doc.frontmatter.title),
    pagetitle: escapeHtml(doc.frontmatter.title),
    author: doc.frontmatter.author.join(', '),
    ...(pageAuthorHref !== undefined && { 'author-href': pageAuthorHref }),
    body: doc.htmlFragment ?? '',
    'feed-items': feedItems,
    count: feedItems.length,
  };
}
