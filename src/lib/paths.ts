import { isAbsolute, join, normalize, relative, sep } from 'node:path';

/** Ruta absoluta resuelta contra la raíz del proyecto. */
export function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? normalize(path) : join(cwd, normalize(path));
}

/** Separadores de ruta hacia `/`, que es lo que viajan en hrefs y en el .md. */
export function posix(path: string): string {
  return path.split(sep).join('/');
}

/** Si `abs` cae debajo de `root`. La propia raíz no cuenta: es lo que hace falta para replicar. */
export function isInside(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
  }
}
