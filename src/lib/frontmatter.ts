/**
 * Parser de frontmatter YAML compartido entre discover y validate.
 * Única fuente de verdad para la regex y la separación YAML/body.
 */

import { parseDocument } from 'yaml';

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

/**
 * Parsea YAML con posición en los errores (línea/columna). La librería `yaml`
 * expone linePos en sus errores de parseo; Bun.YAML.parse no. Retorna el
 * valor parseado o un mensaje de error con la posición cuando el parser la
 * produce.
 */
export function parseYamlWithPosition(raw: string): { value?: unknown; error?: string } {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    if (!first) return { error: 'Error de sintaxis YAML' };
    const linePos = first.linePos?.[0];
    const position = linePos ? ` (línea ${linePos.line}, columna ${linePos.col})` : '';
    return { error: `${first.message}${position}` };
  }
  return { value: doc.toJS() };
}
