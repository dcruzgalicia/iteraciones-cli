import type { SiteConfig } from '../config/site-config.js';
import type { BuildDocument, DocumentType } from './types.js';

/**
 * Agrupa los documentos por tipo, ordena cada grupo por fecha descendente
 * (documentos sin fecha quedan al final) y recorta al límite de `listItemsLimit`.
 *
 * Solo se incluyen documentos que tienen `type` asignado (post-classify).
 */
export function collectByType(docs: BuildDocument[], config: SiteConfig): Map<DocumentType, BuildDocument[]> {
  const index = new Map<DocumentType, BuildDocument[]>();

  for (const doc of docs) {
    if (!doc.type) continue;
    const group = index.get(doc.type) ?? [];
    group.push(doc);
    index.set(doc.type, group);
  }

  const limit = config.listItemsLimit;

  for (const [type, group] of index) {
    group.sort((a, b) => {
      const da = a.frontmatter.date ? new Date(a.frontmatter.date).getTime() : -Infinity;
      const db = b.frontmatter.date ? new Date(b.frontmatter.date).getTime() : -Infinity;
      return db - da;
    });
    index.set(type, group.slice(0, limit));
  }

  return index;
}
