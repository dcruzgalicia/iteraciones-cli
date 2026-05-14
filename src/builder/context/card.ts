import type { TemplateContext } from '../../template/render/context.js';
import type { BuildDocument } from '../types.js';

/**
 * Construye el TemplateContext para un documento de tipo `card`.
 *
 * Variables producidas para `templates/card.html`:
 *   title     → frontmatter.title
 *   pagetitle → frontmatter.title
 *   body      → htmlFragment del documento (contenido del bloque)
 */
export function buildCardContext(doc: BuildDocument): TemplateContext {
  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    body: doc.htmlFragment ?? '',
  };
}
