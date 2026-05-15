import type { TemplateContext } from '../../../template/render/context.js';
import { buildRelatedAuthorsContext } from '../../context/authors.js';
import { buildEventContext, buildEventsContext } from '../../context/event.js';
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
 * Recibe los docs tipo `event` ya renderizados; sus metadatos de frontmatter
 * (date, time, location, modality) se exponen en cada item del listado.
 */
export function buildEventsPipelineContext(doc: BuildDocument, siteCtx: TemplateContext, renderedEventDocs: BuildDocument[]): TemplateContext {
  const eventsCtx = buildEventsContext(doc, renderedEventDocs);
  return mergeContexts(siteCtx, eventsCtx);
}
