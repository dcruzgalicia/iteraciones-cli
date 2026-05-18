import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveThemePaths, type ThemePaths } from '../theme-resolver.js';
import type { DocumentType } from '../types.js';

/**
 * Resuelve la ruta absoluta del template HTML para el tipo dado.
 * Prioridad: cwd/templates/{type}.html (proyecto) → tema built-in → claro por defecto.
 *
 * @param preResolvedPaths - Paths del tema ya resueltos; si se proveen, se evita
 * llamar a resolveThemePaths de nuevo (evita emitir el warning de tema desconocido
 * múltiples veces cuando se llama dentro de un loop por archivo).
 */
export function resolveTemplatePath(type: DocumentType, theme?: string, cwd?: string, preResolvedPaths?: ThemePaths): string {
  if (cwd) {
    const projectTemplate = join(cwd, 'templates', `${type}.html`);
    if (existsSync(projectTemplate)) return projectTemplate;
  }
  return join((preResolvedPaths ?? resolveThemePaths(theme)).templatesDir, `${type}.html`);
}
