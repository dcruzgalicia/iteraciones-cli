import type { TemplateContext } from '../../../template/render/context.js';
import { buildListContext } from '../../context/list.js';
import type { BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Construye el TemplateContext completo para un documento de tipo `list`,
 * combinando el contexto del sitio con el contexto de lista.
 *
 * Recibe los docs tipo `file` ya renderizados para que `htmlFragment`
 * (extracto del contenido) esté disponible en cada item del listado.
 */
export function buildListPipelineContext(doc: BuildDocument, siteCtx: TemplateContext, renderedFileDocs: BuildDocument[]): TemplateContext {
  const listCtx = buildListContext(doc, renderedFileDocs);
  return mergeContexts(siteCtx, listCtx);
}
