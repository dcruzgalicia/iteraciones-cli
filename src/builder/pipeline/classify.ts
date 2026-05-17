import { classify } from '../classifier/index.js';
import type { BuildDocument, SourceDocument } from '../types.js';

export function classifyDocuments(docs: SourceDocument[], theme?: string): BuildDocument[] {
  return docs.map((doc) => classify(doc, theme));
}
