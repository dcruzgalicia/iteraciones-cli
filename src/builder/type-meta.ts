export interface TypeMeta {
  chip: string;
  contentChip?: string;
  memberLabel: string;
  cta?: string;
  listTitle?: string;
  listDescription?: string;
}

export type TypeKey = 'file' | 'collection' | 'creator' | 'list' | 'menu' | 'announcement' | 'all';

export const TYPE_META: Record<TypeKey, TypeMeta> = {
  file: {
    chip: 'Texto',
    contentChip: 'Contenido',
    memberLabel: 'Texto',
    cta: 'Leer texto completo',
    listTitle: 'Textos',
    listDescription: 'Textos compartidos por esta comunidad.',
  },
  collection: {
    chip: 'Colección',
    memberLabel: 'Colección',
    cta: 'Ver colección completa',
    listTitle: 'Colecciones',
    listDescription: 'Conjuntos de contenidos reunidos por esta comunidad.',
  },
  creator: {
    chip: 'Colaboradora',
    contentChip: 'Bio',
    memberLabel: 'Colaboradora',
    cta: 'Ver página de la creadora',
    listTitle: 'Colaboradoras',
    listDescription: 'Personas que participan en esta comunidad.',
  },
  list: {
    chip: 'Lista',
    memberLabel: 'Lista',
    cta: 'Ver lista completa',
    listTitle: 'Listas',
    listDescription: 'Listas de contenidos de esta comunidad.',
  },
  menu: { chip: 'Menú', contentChip: 'Menú', memberLabel: 'Menú' },
  announcement: {
    chip: 'Anuncio',
    memberLabel: 'Anuncio',
    cta: 'Leer anuncio',
    listTitle: 'Anuncios',
    listDescription: 'Avisos de esta comunidad.',
  },
  all: {
    chip: 'Publicaciones',
    memberLabel: 'Publicaciones',
    listTitle: 'Publicaciones',
    listDescription: 'Publicaciones compartidas por esta comunidad.',
  },
};
