import { join } from 'node:path';
import type { DocumentType } from '../types.js';

/**
 * Resuelve la ruta absoluta del template HTML interno del CLI para el tipo dado.
 * Los templates viven en templates/{type}.html relativo a la raíz del paquete.
 */
export function resolveTemplatePath(type: DocumentType): string {
  // import.meta.dir apunta a src/builder/classifier/; subimos tres niveles para llegar a la raíz
  return join(import.meta.dir, '../../../templates', `${type}.html`);
}
