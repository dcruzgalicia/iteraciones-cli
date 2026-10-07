import { isAbsolute, join, normalize, relative, sep } from 'node:path';

export function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? normalize(path) : join(cwd, normalize(path));
}

export function posix(path: string): string {
  return path.split(sep).join('/');
}

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
