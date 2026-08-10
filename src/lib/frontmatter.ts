/**
 * Parser de frontmatter YAML compartido entre discover y validate.
 * Única fuente de verdad para la regex y la separación YAML/body.
 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Separa el frontmatter YAML del body del documento.
 * Si no hay frontmatter, retorna solo el body completo.
 */
export function splitFrontmatter(content: string): { yaml?: string; body: string } {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { body: content };
  return { yaml: fmMatch[1], body: content.slice(fmMatch[0].length) };
}
