import type { TemplateContext } from '../../../template/render/context.js';
import { buildRelatedAuthorsContext } from '../../context/authors.js';
import { buildListContext } from '../../context/list.js';
import { buildPageHrefs, buildPaginationContext, paginateItems } from '../../paginate.js';
import type { AuthorDocumentIndex, BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Construye el TemplateContext completo para un documento de tipo `list`,
 * combinando el contexto del sitio con el contexto de lista.
 *
 * Usado exclusivamente para documentos con `kind === 'block'` (bloques).
 * Los bloques no se paginan: reciben todos los `renderedFileDocs` como una sola lista.
 */
export function buildListPipelineContext(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  renderedFileDocs: BuildDocument[],
  authorIndex?: AuthorDocumentIndex,
): TemplateContext {
  const listCtx = buildListContext(doc, renderedFileDocs, authorIndex);
  const relatedAuthorsCtx = authorIndex ? buildRelatedAuthorsContext(doc, authorIndex) : {};
  return mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), listCtx);
}

/**
 * Genera un `BuildDocument` por página para un documento de tipo `list`.
 *
 * Divide `renderedFileDocs` en páginas de `limit` items y por cada página
 * produce un doc derivado con:
 *   - `relativePath` ajustado (página 1 conserva la ruta original; páginas
 *     siguientes usan `<base>/N.md` → `<base>/N.html` en la salida).
 *   - `templateContext` con variables de paginación (`has-pagination`,
 *     `page-number`, `page-count`, `total-items`, `page-previous`, `page-next`).
 */
export function buildPagedListPipelineContexts(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  renderedFileDocs: BuildDocument[],
  limit: number,
  authorIndex?: AuthorDocumentIndex,
): BuildDocument[] {
  const pages = paginateItems(renderedFileDocs, limit, doc.relativePath);
  const pageHrefs = buildPageHrefs(doc.relativePath, pages.length);
  const relatedAuthorsCtx = authorIndex ? buildRelatedAuthorsContext(doc, authorIndex) : {};

  return pages.map((page) => {
    const paginationCtx = buildPaginationContext(page, pageHrefs);
    const listCtx = buildListContext(doc, page.items, authorIndex, paginationCtx);
    const templateContext = mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), listCtx);
    return { ...doc, relativePath: page.pageRelativePath, templateContext };
  });
}
