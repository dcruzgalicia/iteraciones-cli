import type { TemplateContext } from '../../../template/render/context.js';
import { buildMenuContext } from '../../context/menu.js';
import type { BuildDocument } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Construye el TemplateContext completo para un documento de tipo `menu`,
 * combinando el contexto del sitio con el contexto del menú.
 *
 * Los items de navegación provienen del frontmatter del propio documento,
 * por lo que no se necesitan documentos externos.
 */
export function buildMenuPipelineContext(doc: BuildDocument, siteCtx: TemplateContext): TemplateContext {
  const menuCtx = buildMenuContext(doc);
  return mergeContexts(siteCtx, menuCtx);
}
