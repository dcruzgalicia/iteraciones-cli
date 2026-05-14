import type { TemplateContext } from '../../../template/render/context.js';
import { buildAuthorContext, buildAuthorsContext } from '../../context/authors.js';
import type { BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

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
 * Recibe los docs tipo `author` ya renderizados para que `htmlFragment`
 * (bio del autor) esté disponible al construir el contexto.
 */
export function buildAuthorsPipelineContext(doc: BuildDocument, siteCtx: TemplateContext, renderedAuthorDocs: BuildDocument[]): TemplateContext {
  const authorsCtx = buildAuthorsContext(doc, renderedAuthorDocs);
  return mergeContexts(siteCtx, authorsCtx);
}
