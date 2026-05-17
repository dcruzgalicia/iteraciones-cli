/**
 * Directorios que el CLI ignora al escanear el proyecto.
 * Fuente única de verdad — importar desde aquí en discover, validate y loader.
 */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);
