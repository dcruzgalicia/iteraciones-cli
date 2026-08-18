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
 *
 * El mensaje se recorta a una sola línea: la librería incluye el snippet
 * ofensivo (línea + caret) y la posición en el texto; aquí solo se conserva la
 * causa y la posición, una única vez.
 */
export function parseYamlWithPosition(raw: string): { value?: unknown; error?: string } {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    if (!first) return { error: 'Error de sintaxis YAML' };
    const linePos = first.linePos?.[0];
    const position = linePos ? ` (línea ${linePos.line}, columna ${linePos.col})` : '';
    // La primera línea de la librería termina con "at line N, column M:" cuando
    // tiene posición: se elimina para que no se duplique con la nuestra.
    const cause = (first.message.split('\n')[0] ?? first.message).replace(/ at line \d+, column \d+:$/, '');
    return { error: `${cause}${position}` };
  }
  return { value: doc.toJS() };
}
