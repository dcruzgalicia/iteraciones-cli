import { relativeHref } from './pipeline-io.js';

/**
 * Las listas por defecto: una página por type, con los documentos de ese type
 * como tarjetas. No hay archivo fuente: el build las escribe en la raíz de la
 * salida.
 */
export const DEFAULT_LISTS = [
  {
    type: 'file',
    slug: 'texto',
    title: 'Textos',
    description: 'Los textos de esta iteración: ciencia, ciencia ficción y matemáticas, escritos por sus autoras.',
  },
  { type: 'collection', slug: 'coleccion', title: 'Colecciones', description: 'Las colecciones que reúnen los textos de esta iteración.' },
  { type: 'creator', slug: 'creadora', title: 'Creadoras', description: 'Las creadoras que escriben, comparten y re-existen en esta iteración.' },
  { type: 'list', slug: 'lista', title: 'Listas', description: 'Las listas que organizan los contenidos de esta iteración.' },
  {
    type: 'all',
    slug: 'index',
    title: 'Publicaciones',
    description: 'Todas las publicaciones de esta iteración: ciencia, ciencia ficción y matemáticas.',
  },
] as const;

export function defaultListSlug(type: string | undefined): string | undefined {
  if (type === 'all') return undefined;
  return DEFAULT_LISTS.find((lista) => lista.type === (type ?? 'file'))?.slug;
}

/** A dónde lleva el chip de un type: a su lista por defecto. */
export function defaultListHref(dir: string, type: string | undefined): string | undefined {
  const slug = defaultListSlug(type);
  if (slug === undefined) return undefined;
  return relativeHref(dir, `${slug}.html`);
}
