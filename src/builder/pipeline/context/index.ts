import type { TemplateContext } from '../../../template/render/context.js';
import type { BuildDocument } from '../../types.js';
import { buildDocumentContext } from './document.js';
import { mergeContexts } from './merge.js';

export function buildContext(doc: BuildDocument, siteCtx: TemplateContext): TemplateContext {
  const docCtx = buildDocumentContext(doc, doc.htmlFragment ?? '');
  return mergeContexts(siteCtx, docCtx);
}
