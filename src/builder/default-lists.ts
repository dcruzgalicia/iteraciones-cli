import { relativePageHref } from '../lib/paths.js';
import { TYPE_META, type TypeKey } from './type-meta.js';

const lista = (type: TypeKey, slug: string) => ({
  type,
  slug,
  title: TYPE_META[type].listTitle ?? '',
  description: TYPE_META[type].listDescription ?? '',
});

export const DEFAULT_LISTS = [
  lista('file', 'texto'),
  lista('collection', 'coleccion'),
  lista('creator', 'creadora'),
  lista('list', 'lista'),
  lista('announcement', 'anuncio'),
  lista('all', 'index'),
] as const;

export function defaultListSlug(type: string | undefined): string | undefined {
  if (type === 'all') return undefined;
  return DEFAULT_LISTS.find((lista) => lista.type === (type ?? 'file'))?.slug;
}

export function defaultListHref(dir: string, type: string | undefined): string | undefined {
  const slug = defaultListSlug(type);
  if (slug === undefined) return undefined;
  return relativePageHref(dir, `${slug}.html`);
}
