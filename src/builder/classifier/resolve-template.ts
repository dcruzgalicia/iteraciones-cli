import { join } from 'node:path';
import { resolveThemePaths } from '../theme-resolver.js';
import type { DocumentType } from '../types.js';

/**
 * Resuelve la ruta absoluta del template HTML para el tipo dado según el tema activo.
 * Los templates viven en templates/{type}.html relativo a la raíz del paquete,
 * o en themes/{name}/templates/{type}.html para temas distintos al claro por defecto.
 */
export function resolveTemplatePath(type: DocumentType, theme?: string): string {
  return join(resolveThemePaths(theme).templatesDir, `${type}.html`);
}
