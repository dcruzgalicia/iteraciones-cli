import type { BuildDocument, DocumentType } from '../types.js';
import { TYPE_STAGES } from './type-graph.js';

/**
 * Tipos que agregan contenido de otros documentos (fase index). Siempre deben
 * reprocesarse cuando cualquier archivo fuente cambia.
 */
const INDEX_TYPES = new Set<DocumentType>(TYPE_STAGES.filter((s) => s.phase === 'index').map((s) => s.type));

/**
 * Calcula el conjunto de documentos que deben reprocesarse en un build
 * incremental dado un conjunto de rutas de archivos modificadas.
 *
 * Reglas:
 * - Cualquier doc cuya ruta relativa esté en `changedPaths` → siempre afectado.
 * - Cualquier doc de tipo index (collection, authors, events, menu, card, list)
 *   → siempre afectado porque agregan contenido de otros documentos.
 * - Cualquier doc con `kind === 'block'` → siempre afectado porque pueden
 *   aparecer en cualquier página del sitio.
 *
 * @param changedPaths Rutas relativas de los archivos que cambiaron.
 * @param allDocs      Pool completo de documentos activos (sin borradores).
 * @returns Set de `relativePath` de los documentos a reprocesar.
 */
export function computeAffectedDocs(changedPaths: Set<string>, allDocs: BuildDocument[]): Set<string> {
  const affected = new Set<string>();
  for (const doc of allDocs) {
    if (changedPaths.has(doc.relativePath) || (doc.type !== undefined && INDEX_TYPES.has(doc.type)) || doc.kind === 'block') {
      affected.add(doc.relativePath);
    }
  }
  return affected;
}
