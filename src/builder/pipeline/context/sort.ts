import type { BuildDocument } from '../../types.js';

/**
 * Ordena documentos por fecha descendente; los que no tienen fecha quedan al final.
 */
export function sortByDateDesc(docs: BuildDocument[]): BuildDocument[] {
  return [...docs].sort((a, b) => {
    const rawA = a.frontmatter.date ? new Date(a.frontmatter.date).getTime() : Number.NEGATIVE_INFINITY;
    const rawB = b.frontmatter.date ? new Date(b.frontmatter.date).getTime() : Number.NEGATIVE_INFINITY;
    const da = Number.isNaN(rawA) ? Number.NEGATIVE_INFINITY : rawA;
    const db = Number.isNaN(rawB) ? Number.NEGATIVE_INFINITY : rawB;
    return db - da;
  });
}
