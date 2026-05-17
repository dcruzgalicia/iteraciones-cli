import type { TemplateContext } from '../../../template/render/context.js';
import { buildAuthorContext, buildAuthorsContext } from '../../context/authors.js';
import { buildPageHrefs, buildPaginationContext, paginateItems } from '../../paginate.js';
import type { BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Ordena un array de docs de tipo `author` alfabéticamente por `frontmatter.title`
 * (nombre del autor) de forma insensible a mayúsculas y diacríticos.
 */
function sortByTitleAsc(docs: BuildDocument[]): BuildDocument[] {
  return [...docs].sort((a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title, undefined, { sensitivity: 'base' }));
}

/**
 * Construye el TemplateContext completo para un documento de tipo `author`,
 * combinando el contexto del sitio con el contexto de autor.
 *
 * Recibe todos los docs tipo `file` ya renderizados (sin recortar a listItemsLimit)
 * para que el filtrado por nombre de autor sea sobre el conjunto completo.
 */
export function buildAuthorPipelineContext(doc: BuildDocument, siteCtx: TemplateContext, renderedFileDocs: BuildDocument[]): TemplateContext {
  const authorCtx = buildAuthorContext(doc, renderedFileDocs);
  return mergeContexts(siteCtx, authorCtx);
}

/**
 * Construye el TemplateContext completo para un documento de tipo `authors`,
 * combinando el contexto del sitio con el contexto del índice de autores.
 *
 * Usado exclusivamente para documentos con `kind === 'block'` (bloques).
 * Los bloques no se paginan: reciben todos los `renderedAuthorDocs` como una sola lista.
 */
export function buildAuthorsPipelineContext(doc: BuildDocument, siteCtx: TemplateContext, renderedAuthorDocs: BuildDocument[]): TemplateContext {
  const authorsCtx = buildAuthorsContext(doc, sortByTitleAsc(renderedAuthorDocs));
  return mergeContexts(siteCtx, authorsCtx);
}

/**
 * Genera un `BuildDocument` por página para un documento de tipo `authors`.
 *
 * Divide `renderedAuthorDocs` en páginas de `limit` items y por cada página
 * produce un doc derivado con `relativePath` ajustado y variables de paginación
 * en el `templateContext`.
 */
export function buildPagedAuthorsPipelineContexts(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  renderedAuthorDocs: BuildDocument[],
  limit: number,
): BuildDocument[] {
  const sortedDocs = sortByTitleAsc(renderedAuthorDocs);
  const pages = paginateItems(sortedDocs, limit, doc.relativePath);
  const pageHrefs = buildPageHrefs(doc.relativePath, pages.length);

  return pages.map((page) => {
    const paginationCtx = buildPaginationContext(page, pageHrefs);
    const authorsCtx = buildAuthorsContext(doc, page.items, paginationCtx);
    const templateContext = mergeContexts(siteCtx, authorsCtx);
    return { ...doc, relativePath: page.pageRelativePath, templateContext };
  });
}
