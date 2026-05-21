import type { TemplateContext } from '../../../template/render/context.js';
import { buildRelatedAuthorsContext } from '../../context/authors.js';
import { buildFeedContext } from '../../context/feed.js';
import type { AuthorDocumentIndex, BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';
import { sortByDateDesc } from './sort.js';

/**
 * Aplica los filtros declarados en `doc.frontmatter.filters` sobre `allDocs`.
 * Siempre excluye el propio documento. Sin `filters:` devuelve todo `allDocs`
 * menos el doc. Con filtros aplica AND entre criterios y OR dentro de cada uno.
 */
function applyFeedFilters(doc: BuildDocument, allDocs: BuildDocument[]): BuildDocument[] {
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
 * Construye el TemplateContext completo para un documento de tipo `feed`.
 *
 * Aplica filtros, ordena por fecha descendente y trunca al límite declarado en
 * `doc.frontmatter.limit` (default 3). No pagina: devuelve siempre un único contexto.
 *
 * Usado tanto para páginas (kind === 'page') como para bloques (kind === 'block').
 * En modo bloque, `pool` contiene solo los tipos primarios disponibles en el
 * pre-paso (file, author, event); `filters.type` con tipos index no producirá
 * resultados — limitación arquitectural conocida compartida con `list`.
 */
export function buildFeedPipelineContext(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  pool: BuildDocument[],
  authorIndex?: AuthorDocumentIndex,
): TemplateContext {
  const filteredDocs = applyFeedFilters(doc, pool);
  const sortedDocs = sortByDateDesc(filteredDocs);
  const limit = doc.frontmatter.limit ?? 3;
  const limitedDocs = sortedDocs.slice(0, limit);
  const feedCtx = buildFeedContext(doc, limitedDocs, authorIndex);
  const relatedAuthorsCtx = authorIndex ? buildRelatedAuthorsContext(doc, authorIndex) : {};
  return mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), feedCtx);
}
