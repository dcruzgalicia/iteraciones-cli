import type { TemplateContext } from '../../../template/render/context.js';
import type { AuthorDocumentIndex, BuildDocument } from '../../types.js';
import { buildDocumentContext } from './document.js';
import { mergeContexts } from './merge.js';

export function buildContext(doc: BuildDocument, siteCtx: TemplateContext, authorIndex?: AuthorDocumentIndex): TemplateContext {
  if (doc.htmlFragment === undefined) {
    throw new Error(`buildContext: htmlFragment no está definido en "${doc.relativePath}". ¿Se ejecutó el paso de render?`);
  }
  const docCtx = buildDocumentContext(doc, doc.htmlFragment, authorIndex);
  return mergeContexts(siteCtx, docCtx);
}
