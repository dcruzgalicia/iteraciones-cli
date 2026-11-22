import { isAbsolute, join, relative, resolve } from 'node:path';
import { posix } from './paths.js';

export function resolveMediaPath(value: string, docDir: string, projectRoot: string): string {
  if (value.startsWith('/') && projectRoot !== '') return join(projectRoot, value.slice(1));
  return isAbsolute(value) ? value : resolve(docDir, value);
}

export function normalizeMediaPaths(text: string, docDir: string, projectRoot: string): string {
  const rel = posix(relative(docDir, projectRoot));
  const base = rel === '' ? 'assets' : `${rel}/assets`;
  return text.replace(/(^|[^A-Za-z0-9.:/])\/assets\/images\//g, (_match, pre: string) => `${pre}${base}/images/`);
}

export function normalizeMediaFields(value: unknown, docDir: string, projectRoot: string): unknown {
  if (typeof value === 'string') return normalizeMediaPaths(value, docDir, projectRoot);
  if (Array.isArray(value)) return value.map((item) => normalizeMediaFields(item, docDir, projectRoot));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeMediaFields(item, docDir, projectRoot)]));
  }
  return value;
}
