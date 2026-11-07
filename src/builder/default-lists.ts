import { relativeHref } from './pipeline-io.js';

export const DEFAULT_LISTS = [
  {
    type: 'file',
    slug: 'texto',
    title: 'Textos',
    description: 'Textos compartidos por esta comunidad.',
  },
  { type: 'collection', slug: 'coleccion', title: 'Colecciones', description: 'Conjuntos de contenidos reunidos por esta comunidad.' },
  { type: 'creator', slug: 'creadora', title: 'Colaboradoras', description: 'Personas que participan en esta comunidad.' },
  { type: 'list', slug: 'lista', title: 'Listas', description: 'Listas de contenidos de esta comunidad.' },
  { type: 'announcement', slug: 'anuncio', title: 'Anuncios', description: 'Avisos de esta comunidad.' },
  {
    type: 'all',
    slug: 'index',
    title: 'Publicaciones',
    description: 'Publicaciones compartidas por esta comunidad.',
  },
] as const;

export function defaultListSlug(type: string | undefined): string | undefined {
  if (type === 'all') return undefined;
  return DEFAULT_LISTS.find((lista) => lista.type === (type ?? 'file'))?.slug;
}

export function defaultListHref(dir: string, type: string | undefined): string | undefined {
  const slug = defaultListSlug(type);
  if (slug === undefined) return undefined;
  return relativeHref(dir, `${slug}.html`);
}
