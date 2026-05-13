import type { Frontmatter } from '../../loader/frontmatter.js';
import type { DocumentType } from '../types.js';

const VALID_TYPES = new Set<string>(['file', 'collection', 'author', 'authors', 'event', 'events', 'menu', 'card', 'list']);

/**
 * Infiere el DocumentType desde el campo `type` del frontmatter.
 * Si el valor no es un tipo válido, retorna `'file'` como default.
 */
export function inferType(frontmatter: Frontmatter): DocumentType {
  if (VALID_TYPES.has(frontmatter.type)) {
    return frontmatter.type as DocumentType;
  }
  return 'file';
}
