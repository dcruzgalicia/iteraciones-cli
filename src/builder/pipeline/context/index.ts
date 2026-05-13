import type { TemplateContext } from '../../../template/render/context.js';
import type { BuildDocument } from '../../types.js';
import { buildDocumentContext } from './document.js';
import { mergeContexts } from './merge.js';

export function buildContext(doc: BuildDocument, siteCtx: TemplateContext): TemplateContext {
  if (doc.htmlFragment === undefined) {
    throw new Error(`buildContext: htmlFragment no está definido en "${doc.relativePath}". ¿Se ejecutó el paso de render?`);
  }
  const docCtx = buildDocumentContext(doc, doc.htmlFragment);
  return mergeContexts(siteCtx, docCtx);
}
