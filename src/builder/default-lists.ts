import { relativeHref } from './pipeline-io.js';

/**
 * Las listas por defecto: una página por type, con los documentos de ese type
 * como tarjetas. No hay archivo fuente: el build las escribe en la raíz de la
 * salida.
 */
export const DEFAULT_LISTS = [
  { type: 'file', slug: 'texto', title: 'Texto' },
  { type: 'collection', slug: 'coleccion', title: 'Colección' },
  { type: 'creator', slug: 'creadora', title: 'Creadora' },
  { type: 'list', slug: 'lista', title: 'Lista' },
  { type: 'all', slug: 'index', title: 'Inicio' },
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
