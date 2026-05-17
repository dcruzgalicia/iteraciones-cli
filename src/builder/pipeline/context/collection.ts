import type { TemplateContext } from '../../../template/render/context.js';
import { buildRelatedAuthorsContext } from '../../context/authors.js';
import { buildCollectionContext } from '../../context/collection.js';
import { buildPageHrefs, buildPaginationContext, paginateItems } from '../../paginate.js';
import type { AuthorDocumentIndex, BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Resuelve los items de un doc `collection` buscando cada ruta de
 * `doc.frontmatter.items` en `allDocs`. Lanza un error de build si alguna
 * ruta declarada no existe. Respeta el orden editorial de `items:`.
 */
function resolveCollectionItems(doc: BuildDocument, allDocs: BuildDocument[]): BuildDocument[] {
  const docsByPath = new Map<string, BuildDocument>(allDocs.map((d) => [d.relativePath, d]));
  return doc.frontmatter.items.map((itemPath) => {
    const found = docsByPath.get(itemPath);
    if (!found) throw new Error(`collection "${doc.relativePath}": item no encontrado: "${itemPath}"`);
    return found;
  });
}

/**
 * Construye el TemplateContext completo para un bloque de tipo `collection`.
 * No aplica paginación. Lanza error de build si alguna ruta de `items:` no existe.
 */
export function buildCollectionPipelineContext(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  allDocs: BuildDocument[],
  authorIndex?: AuthorDocumentIndex,
): TemplateContext {
  const items = resolveCollectionItems(doc, allDocs);
  const collectionCtx = buildCollectionContext(doc, items, authorIndex);
  const relatedAuthorsCtx = authorIndex ? buildRelatedAuthorsContext(doc, authorIndex) : {};
  return mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), collectionCtx);
}

/**
 * Genera un `BuildDocument` por página para un documento de tipo `collection`.
 *
 * Busca cada ruta de `doc.frontmatter.items` en `allDocs`. Lanza error de build
 * si alguna ruta no existe. Respeta el orden declarado en `items:` (sin reordenar
 * por fecha). Aplica paginación si el total de items supera `limit`.
 */
export function buildPagedCollectionPipelineContexts(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  allDocs: BuildDocument[],
  limit: number,
  authorIndex?: AuthorDocumentIndex,
): BuildDocument[] {
  const resolvedItems = resolveCollectionItems(doc, allDocs);
  const pages = paginateItems(resolvedItems, limit, doc.relativePath);
  const pageHrefs = buildPageHrefs(doc.relativePath, pages.length);
  const relatedAuthorsCtx = authorIndex ? buildRelatedAuthorsContext(doc, authorIndex) : {};

  return pages.map((page) => {
    const paginationCtx = buildPaginationContext(page, pageHrefs);
    const collectionCtx = buildCollectionContext(doc, page.items, authorIndex, paginationCtx);
    const templateContext = mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), collectionCtx);
    return { ...doc, relativePath: page.pageRelativePath, templateContext };
  });
}
