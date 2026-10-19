import { isAbsolute, relative, sep } from 'node:path';

export function posix(path: string): string {
  return path.split(sep).join('/');
}

export function relativeLabel(root: string, path: string): string {
  const rel = relative(root, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

export function escapeRegExp(text: string): string {
  return RegExp.escape(text);
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
