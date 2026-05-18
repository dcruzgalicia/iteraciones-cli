import type { Frontmatter } from '../../loader/frontmatter.js';
import { VALID_TYPES } from '../pipeline/type-graph.js';
import type { DocumentType } from '../types.js';

/**
 * Infiere el DocumentType desde el campo `type` del frontmatter.
 * Si el valor no es un tipo válido, retorna `'file'` como default.
 */
export function inferType(frontmatter: Frontmatter): DocumentType {
  if (VALID_TYPES.has(frontmatter.type as DocumentType)) {
    return frontmatter.type as DocumentType;
  }
  return 'file';
}
