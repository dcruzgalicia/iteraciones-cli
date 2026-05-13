import type { Frontmatter } from '../../loader/frontmatter.js';
import type { DocumentType } from '../types.js';

const VALID_TYPES = new Set<DocumentType>(['file', 'collection', 'author', 'authors', 'event', 'events', 'menu', 'card', 'list']);

/**
 * Infiere el DocumentType desde el campo `type` del frontmatter.
 * Si el valor no es un tipo válido, retorna `'file'` como default.
 */
export function inferType(frontmatter: Frontmatter): DocumentType {
  const raw = frontmatter.type;
  if (typeof raw === 'string' && VALID_TYPES.has(raw as DocumentType)) {
    return raw as DocumentType;
  }
  return 'file';
}
