import type { TemplateContext } from '../../../template/render/context.js';
import { buildCardContext } from '../../context/card.js';
import type { BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Construye el TemplateContext completo para un documento de tipo `card`,
 * combinando el contexto del sitio con el contexto del bloque.
 */
export function buildCardPipelineContext(doc: BuildDocument, siteCtx: TemplateContext): TemplateContext {
  const cardCtx = buildCardContext(doc);
  return mergeContexts(siteCtx, cardCtx);
}
