import type { Frontmatter } from '../../loader/frontmatter.js';
import type { DocumentKind } from '../types.js';

/**
 * Infiere el DocumentKind desde el frontmatter.
 * Retorna `'block'` si `frontmatter.block` es true, sino `'page'`.
 */
export function inferKind(frontmatter: Frontmatter): DocumentKind {
  return frontmatter.block ? 'block' : 'page';
}
