import type { TemplateContext } from '../../template/render/context.js';
import type { BuildDocument } from '../types.js';

/**
 * Construye el subconjunto del TemplateContext que proviene del documento.
 * Sin I/O ni efectos secundarios.
 *
 * Variables producidas:
 *   title     → frontmatter.title
 *   date      → frontmatter.date
 *   author    → frontmatter.author
 *   keywords  → frontmatter.keywords (array, puede ser vacío)
 *   body      → HTML renderizado
 */
export function buildDocumentContext(doc: BuildDocument, renderedHtml: string): TemplateContext {
  return {
    title: doc.frontmatter.title,
    date: doc.frontmatter.date,
    author: doc.frontmatter.author,
    keywords: doc.frontmatter.keywords,
    body: renderedHtml,
  };
}
