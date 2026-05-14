import type { TemplateContext } from '../../../template/render/context.js';
import { buildCollectionContext } from '../../context/collection.js';
import type { BuildDocument, DocumentType } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Construye el TemplateContext completo para un documento de tipo `collection`,
 * combinando el contexto del sitio con el contexto específico de la colección.
 *
 * `index` es el resultado de `collectByType`: la función extrae los items de
 * tipo `'file'` para poblar el listado de la colección.
 */
export function buildCollectionPipelineContext(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  index: Map<DocumentType, BuildDocument[]>,
): TemplateContext {
  const items = index.get('file') ?? [];
  const collectionCtx = buildCollectionContext(doc, items);
  return mergeContexts(siteCtx, collectionCtx);
}
