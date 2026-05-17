import type { TemplateContext } from '../../../template/render/context.js';
import { buildRelatedAuthorsContext } from '../../context/authors.js';
import { buildEventContext, buildEventsContext } from '../../context/event.js';
import { buildPageHrefs, buildPaginationContext, paginateItems } from '../../paginate.js';
import type { AuthorDocumentIndex, BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Construye el TemplateContext completo para un documento de tipo `event`,
 * combinando el contexto del sitio con el contexto del evento.
 *
 * Recibe el AuthorDocumentIndex para resolver:
 *   - `authors`: autores del documento (frontmatter.author) → slot de autores del sidebar.
 *   - `speakers`: ponentes del evento → slot de participantes del sidebar.
 * Ambas categorías son independientes y se renderizan en secciones distintas del layout.
 */
export function buildEventPipelineContext(doc: BuildDocument, siteCtx: TemplateContext, authorIndex: AuthorDocumentIndex): TemplateContext {
  const eventCtx = buildEventContext(doc, authorIndex);
  const relatedAuthorsCtx = buildRelatedAuthorsContext(doc, authorIndex);
  return mergeContexts(mergeContexts(siteCtx, relatedAuthorsCtx), eventCtx);
}

/**
 * Construye el TemplateContext completo para un documento de tipo `events`,
 * combinando el contexto del sitio con el contexto del índice de eventos.
 *
 * Usado exclusivamente para documentos con `kind === 'block'` (bloques).
 * Los bloques no se paginan: reciben todos los `renderedEventDocs` como una sola lista.
 * Pasa la fecha actual de build para generar las variables `upcoming-items` y `past-items`.
 */
export function buildEventsPipelineContext(doc: BuildDocument, siteCtx: TemplateContext, renderedEventDocs: BuildDocument[]): TemplateContext {
  const eventsCtx = buildEventsContext(doc, renderedEventDocs, undefined, new Date());
  return mergeContexts(siteCtx, eventsCtx);
}

/**
 * Genera un `BuildDocument` por página para un documento de tipo `events`.
 *
 * Ordena los eventos globalmente (próximos asc, pasados desc) antes de paginar,
 * y pasa la fecha de build para generar `upcoming-items` y `past-items` por página.
 * Divide el pool ordenado en páginas de `limit` items y por cada página
 * produce un doc derivado con `relativePath` ajustado y variables de paginación.
 */
export function buildPagedEventsPipelineContexts(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  renderedEventDocs: BuildDocument[],
  limit: number,
): BuildDocument[] {
  const buildDate = new Date();
  const ref = new Date(buildDate).setHours(0, 0, 0, 0);
  const upcoming = renderedEventDocs
    .filter((d) => {
      const ts = d.frontmatter.date ? new Date(d.frontmatter.date).getTime() : Number.NaN;
      return !Number.isNaN(ts) && ts >= ref;
    })
    .sort((a, b) => new Date(a.frontmatter.date).getTime() - new Date(b.frontmatter.date).getTime());
  const past = renderedEventDocs
    .filter((d) => {
      const ts = d.frontmatter.date ? new Date(d.frontmatter.date).getTime() : Number.NaN;
      return Number.isNaN(ts) || ts < ref;
    })
    .sort((a, b) => new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime());
  const sortedDocs = [...upcoming, ...past];

  const pages = paginateItems(sortedDocs, limit, doc.relativePath);
  const pageHrefs = buildPageHrefs(doc.relativePath, pages.length);

  return pages.map((page) => {
    const paginationCtx = buildPaginationContext(page, pageHrefs);
    const eventsCtx = buildEventsContext(doc, page.items, paginationCtx, buildDate);
    const templateContext = mergeContexts(siteCtx, eventsCtx);
    return { ...doc, relativePath: page.pageRelativePath, templateContext };
  });
}
