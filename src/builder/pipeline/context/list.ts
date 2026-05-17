import type { TemplateContext } from '../../../template/render/context.js';
import { buildRelatedAuthorsContext } from '../../context/authors.js';
import { buildListContext } from '../../context/list.js';
import { buildPageHrefs, buildPaginationContext, paginateItems } from '../../paginate.js';
import type { AuthorDocumentIndex, BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Aplica los filtros declarados en `doc.frontmatter.filters` sobre `allDocs`.
 * Siempre excluye el propio documento. Sin `filters:` devuelve todo `allDocs`
 * menos el doc. Con filtros aplica AND entre criterios y OR dentro de cada uno.
 */
function applyListFilters(doc: BuildDocument, allDocs: BuildDocument[]): BuildDocument[] {
  let result = allDocs.filter((d) => d.relativePath !== doc.relativePath);

  const filters = doc.frontmatter.filters;
  if (!filters) return result;

  if (filters.type && filters.type.length > 0) {
    const types = new Set(filters.type.map((t) => t.toLowerCase()));
    result = result.filter((d) => types.has((d.type ?? '').toLowerCase()));
  }

  if (filters.keywords && filters.keywords.length > 0) {
    const filterKws = filters.keywords.map((k) => k.toLowerCase());
    result = result.filter((d) => d.frontmatter.keywords.some((k) => filterKws.includes(k.toLowerCase())));
  }

  if (filters.author && filters.author.length > 0) {
    const filterAuthors = filters.author.map((a) => a.toLowerCase());
    result = result.filter((d) => d.frontmatter.author.some((a) => filterAuthors.includes(a.toLowerCase())));
  }

  return result;
}

/**
 * Ordena documentos por fecha descendente; los que no tienen fecha quedan al final.
 */
function sortByDateDesc(docs: BuildDocument[]): BuildDocument[] {
  return [...docs].sort((a, b) => {
    const rawA = a.frontmatter.date ? new Date(a.frontmatter.date).getTime() : Number.NEGATIVE_INFINITY;
    const rawB = b.frontmatter.date ? new Date(b.frontmatter.date).getTime() : Number.NEGATIVE_INFINITY;
    const da = Number.isNaN(rawA) ? Number.NEGATIVE_INFINITY : rawA;
    const db = Number.isNaN(rawB) ? Number.NEGATIVE_INFINITY : rawB;
    return db - da;
  });
}

/**
 * Construye el TemplateContext completo para un documento de tipo `list`,
 * combinando el contexto del sitio con el contexto de lista.
 *
 * Usado exclusivamente para documentos con `kind === 'block'` (bloques).
 * Los bloques no se paginan: reciben todos los `renderedFileDocs` como una sola lista.
 * Los filtros declarados en `doc.frontmatter.filters` se aplican sobre `renderedFileDocs`.
 */
export function buildListPipelineContext(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  renderedFileDocs: BuildDocument[],
  authorIndex?: AuthorDocumentIndex,
): TemplateContext {
  const filteredDocs = applyListFilters(doc, renderedFileDocs);
  const sortedDocs = sortByDateDesc(filteredDocs);
  const listCtx = buildListContext(doc, sortedDocs, authorIndex);
  const relatedAuthorsCtx = authorIndex ? buildRelatedAuthorsContext(doc, authorIndex) : {};
  return mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), listCtx);
}

/**
 * Genera un `BuildDocument` por página para un documento de tipo `list`.
 *
 * Aplica los filtros de `doc.frontmatter.filters` sobre `allDocs` (pool completo
 * de docs renderizados disponibles), ordena por fecha descendente y pagina con `limit`.
 * Sin `filters:` lista todo el sitio excepto el propio documento.
 */
export function buildPagedListPipelineContexts(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  allDocs: BuildDocument[],
  limit: number,
  authorIndex?: AuthorDocumentIndex,
): BuildDocument[] {
  const filteredDocs = applyListFilters(doc, allDocs);
  const sortedDocs = sortByDateDesc(filteredDocs);
  const pages = paginateItems(sortedDocs, limit, doc.relativePath);
  const pageHrefs = buildPageHrefs(doc.relativePath, pages.length);
  const relatedAuthorsCtx = authorIndex ? buildRelatedAuthorsContext(doc, authorIndex) : {};

  return pages.map((page) => {
    const paginationCtx = buildPaginationContext(page, pageHrefs);
    const listCtx = buildListContext(doc, page.items, authorIndex, paginationCtx);
    const templateContext = mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), listCtx);
    return { ...doc, relativePath: page.pageRelativePath, templateContext };
  });
}
