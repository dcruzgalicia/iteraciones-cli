import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveThemePaths } from '../theme-resolver.js';
import type { DocumentType } from '../types.js';

/**
 * Resuelve la ruta absoluta del template HTML para el tipo dado.
 * Prioridad: cwd/templates/{type}.html (proyecto) → tema built-in → claro por defecto.
 */
export function resolveTemplatePath(type: DocumentType, theme?: string, cwd?: string): string {
  if (cwd) {
    const projectTemplate = join(cwd, 'templates', `${type}.html`);
    if (existsSync(projectTemplate)) return projectTemplate;
  }
  return join(resolveThemePaths(theme).templatesDir, `${type}.html`);
}
