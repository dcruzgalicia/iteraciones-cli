import type { TemplateContext } from '../../../template/render/context.js';
import { buildRelatedAuthorsContext } from '../../context/authors.js';
import { buildCollectionContext } from '../../context/collection.js';
import { buildPageHrefs, buildPaginationContext, paginateItems } from '../../paginate.js';
import type { AuthorDocumentIndex, BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Retorna la lista plana de rutas de items, concatenando los items sueltos
 * (`items:`) con los items agrupados en partes (`parts:`).
 * El orden editorial se preserva: items sueltos primero, luego cada parte
 * en orden con sus items. Si no hay nada, retorna [].
 */
function resolveItemPaths(doc: BuildDocument): string[] {
  const paths = [...doc.frontmatter.items];
  if (doc.frontmatter.parts) {
    for (const part of doc.frontmatter.parts) {
      paths.push(...part.items);
    }
  }
  return paths;
}

/**
 * Resuelve los items de un doc `collection` buscando cada ruta en `allDocs`.
 * Soporta tanto `items:` plano como `parts:` agrupado.
 * Lanza un error de build si alguna ruta declarada no existe.
 * Respeta el orden editorial.
 */
function resolveCollectionItems(doc: BuildDocument, allDocs: BuildDocument[]): BuildDocument[] {
  const docsByPath = new Map<string, BuildDocument>(allDocs.map((d) => [d.relativePath, d]));
  const itemPaths = resolveItemPaths(doc);
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
  const rawParts = doc.frontmatter.parts ?? undefined;
  const collectionCtx = buildCollectionContext(doc, items, authorIndex, undefined, rawParts, allDocs);
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

  const rawParts = doc.frontmatter.parts ?? undefined;

  return pages.map((page) => {
    const paginationCtx = buildPaginationContext(page, pageHrefs);
    const collectionCtx = buildCollectionContext(doc, page.items, authorIndex, paginationCtx, rawParts, allDocs);
    const templateContext = mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), collectionCtx);
    return { ...doc, relativePath: page.pageRelativePath, templateContext };
  });
}
