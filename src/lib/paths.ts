import { isAbsolute, join, normalize, sep } from 'node:path';

/** Ruta absoluta resuelta contra la raíz del proyecto. */
export function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? normalize(path) : join(cwd, normalize(path));
}

/** Separadores de ruta hacia `/`, que es lo que viajan en hrefs y en el .md. */
export function posix(path: string): string {
  return path.split(sep).join('/');
}
