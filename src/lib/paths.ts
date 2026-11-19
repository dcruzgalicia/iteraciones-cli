import { isAbsolute, posix as pathPosix, relative } from 'node:path';

export function posix(path: string): string {
  return path.replaceAll('\\', '/');
}

export function relativeLabel(root: string, path: string): string {
  const rel = relative(root, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
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

export function relativeAssetHref(fromDir: string, asset: string): string {
  const clean = fromDir.replace(/^\.\//, '').replace(/\/$/, '') || '.';
  const rel = pathPosix.relative(clean, '.');
  return `${rel === '' ? './' : `${rel}/`}${asset.replace(/^\.\//, '')}`;
}

export function relativePageHref(fromDir: string, file: string): string {
  const rel = relativeAssetHref(fromDir, file);
  return rel.startsWith('./') ? rel : `./${rel}`;
}
