import { isAbsolute, relative } from 'node:path';

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
  const clean = fromDir.replace(/^\.\//, '').replace(/\/$/, '');
  const depth = clean === '' || clean === '.' ? 0 : clean.split('/').filter(Boolean).length;
  const prefix = depth === 0 ? './' : '../'.repeat(depth);
  return `${prefix}${asset.replace(/^\.\//, '')}`;
}

export function relativePageHref(fromDir: string, file: string): string {
  const rel = relativeAssetHref(fromDir, file);
  return rel.startsWith('./') ? rel : `./${rel}`;
}
