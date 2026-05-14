import type { TemplateContext } from '../../../template/render/context.js';
import { buildEventContext, buildEventsContext } from '../../context/event.js';
import type { BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Construye el TemplateContext completo para un documento de tipo `event`,
 * combinando el contexto del sitio con el contexto del evento.
 *
 * Los speakers provienen del frontmatter del propio documento, por lo que
 * no se necesitan documentos externos.
 */
export function buildEventPipelineContext(doc: BuildDocument, siteCtx: TemplateContext): TemplateContext {
  const eventCtx = buildEventContext(doc);
  return mergeContexts(siteCtx, eventCtx);
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
