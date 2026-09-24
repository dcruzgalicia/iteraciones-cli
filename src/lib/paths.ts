import { isAbsolute, join, normalize } from 'node:path';

/** Ruta absoluta resuelta contra la raíz del proyecto. */
export function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? normalize(path) : join(cwd, normalize(path));
}
