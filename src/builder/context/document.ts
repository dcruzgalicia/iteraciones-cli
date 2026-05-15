import type { TemplateContext } from '../../template/render/context.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';

/**
 * Construye el subconjunto del TemplateContext que proviene del documento.
 * Sin I/O ni efectos secundarios.
 *
 * Variables producidas:
 *   title       → frontmatter.title
 *   pagetitle   → frontmatter.title (para el <title> del documento HTML)
 *   date        → frontmatter.date
 *   author      → frontmatter.author (unido con ', ')
 *   author-href → href root-relative de la página del primer autor encontrado en
 *                 el índice; ausente cuando no hay índice o ningún autor tiene página
 *   keywords    → frontmatter.keywords (array, puede ser vacío)
 *   body        → HTML renderizado
 */
export function buildDocumentContext(doc: BuildDocument, renderedHtml: string, authorIndex?: AuthorDocumentIndex): TemplateContext {
  let authorHref: string | undefined;
  if (authorIndex) {
    for (const name of doc.frontmatter.author) {
      const authorDoc = authorIndex.get(name.trim().toLowerCase());
      if (authorDoc) {
        authorHref = `/${authorDoc.relativePath.replace(/\.md$/, '.html')}`;
        break;
      }
    }
  }

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    date: doc.frontmatter.date,
    author: doc.frontmatter.author.join(', '),
    ...(authorHref !== undefined && { 'author-href': authorHref }),
    keywords: doc.frontmatter.keywords,
    body: renderedHtml,
  };
}
