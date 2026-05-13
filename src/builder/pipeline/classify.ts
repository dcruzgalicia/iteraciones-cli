import { classify } from '../classifier/index.js';
import type { BuildDocument, SourceDocument } from '../types.js';

export function classifyDocuments(docs: SourceDocument[]): BuildDocument[] {
  return docs.map(classify);
}
