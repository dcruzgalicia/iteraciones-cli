import type { CollectionItem } from '../../../loader/frontmatter.js';
import type { TemplateContext } from '../../../template/render/context.js';
import { buildRelatedAuthorsContext } from '../../context/authors.js';
import { buildCollectionContext } from '../../context/collection.js';
import { buildPageHrefs, buildPaginationContext, paginateItems } from '../../paginate.js';
import type { AuthorDocumentIndex, BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Retorna la lista plana de rutas de items recorriendo recursivamente
 * el nuevo schema unificado `CollectionItem[]`. El orden editorial se
 * preserva. Si no hay nada, retorna [].
 */
function resolveItemPaths(items: CollectionItem[]): string[] {
  const paths: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      paths.push(item);
    } else if ('file' in item && typeof item.file === 'string') {
      paths.push(item.file);
    } else if ('items' in item) {
      paths.push(...resolveItemPaths(item.items));
    }
  }
  return paths;
}

/**
 * Resuelve los items de un doc `collection` buscando cada ruta en `allDocs`.
 * Soporta el nuevo schema unificado `CollectionItem[]`.
 * Lanza un error de build si alguna ruta declarada no existe.
 * Respeta el orden editorial.
 */
function resolveCollectionItems(doc: BuildDocument, allDocs: BuildDocument[]): BuildDocument[] {
  const docsByPath = new Map<string, BuildDocument>(allDocs.map((d) => [d.relativePath, d]));
  const itemPaths = resolveItemPaths(doc.frontmatter.items);
  return itemPaths.map((itemPath) => {
    const found = docsByPath.get(itemPath);
    if (!found) {
      const MAX_SUGGESTIONS = 8;
      const nonBlockPaths = allDocs
        .filter((d) => d.kind !== 'block')
        .map((d) => d.relativePath)
        .sort();
      const shown = nonBlockPaths
        .slice(0, MAX_SUGGESTIONS)
        .map((p) => `  - ${p}`)
        .join('\n');
      const moreCount = nonBlockPaths.length - MAX_SUGGESTIONS;
      const hint = nonBlockPaths.length > 0 ? `\nRutas disponibles:\n${shown}${moreCount > 0 ? `\n  ... (${moreCount} más)` : ''}` : '';
      throw new Error(`collection "${doc.relativePath}": el item "${itemPath}" no existe. ¿Olvidaste crearlo?${hint}`);
    }
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
  const rawItems = doc.frontmatter.items;
  const collectionCtx = buildCollectionContext(doc, items, authorIndex, undefined, rawItems, allDocs);
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

  const rawItems = doc.frontmatter.items;

  return pages.map((page) => {
    const paginationCtx = buildPaginationContext(page, pageHrefs);
    const collectionCtx = buildCollectionContext(doc, page.items, authorIndex, paginationCtx, rawItems, allDocs);
    const templateContext = mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), collectionCtx);
    return { ...doc, relativePath: page.pageRelativePath, templateContext };
  });
}
