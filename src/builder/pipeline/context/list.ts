import type { TemplateContext } from '../../../template/render/context.js';
import { buildListContext } from '../../context/list.js';
import type { BuildDocument, DocumentType } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Construye el TemplateContext completo para un documento de tipo `list`,
 * combinando el contexto del sitio con el contexto de lista.
 *
 * Recibe el índice completo de docs clasificados para obtener los items tipo `file`
 * ya ordenados y recortados por `collectByType`.
 */
export function buildListPipelineContext(doc: BuildDocument, siteCtx: TemplateContext, index: Map<DocumentType, BuildDocument[]>): TemplateContext {
  const items = index.get('file') ?? [];
  const listCtx = buildListContext(doc, items);
  return mergeContexts(siteCtx, listCtx);
}
