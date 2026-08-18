/**
 * Parser de frontmatter YAML compartido entre discover y validate.
 * Única fuente de verdad para la regex y la separación YAML/body.
 */

import { parseDocument } from 'yaml';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Causas de error de la librería `yaml` que se traducen al español. Lista
 * corta y explícita por substring: los mensajes no reconocidos se conservan
 * tal cual (con su posición), sin tabla exhaustiva que mantener.
 */
const YAML_CAUSE_TRANSLATIONS: Array<{ match: string; es: string }> = [
  {
    match: 'All mapping items must start at the same column',
    es: 'los items del mapeo deben empezar en la misma columna (indentación inconsistente)',
  },
  { match: 'Map keys must be unique', es: 'las claves del mapeo deben ser únicas' },
  {
    match: 'Nested mappings are not allowed in compact mappings',
    es: 'no se admiten mapeos anidados dentro de mapeos compactos',
  },
  { match: 'bad indentation', es: 'indentación inválida' },
  {
    match: 'Flow sequence in block collection must be sufficiently indented and end with a ]',
    es: 'la secuencia de flujo debe estar bien indentada y terminar con ]',
  },
  { match: 'Unexpected flow-seq-end token in YAML stream', es: 'hay un ] de más en el YAML' },
  { match: 'Missing closing "quote', es: 'falta la comilla de cierre' },
  { match: 'unexpected end of stream', es: 'el YAML termina de forma inesperada' },
];

/** Traduce una causa conocida de la librería `yaml`; si no coincide, la conserva. */
function translateYamlCause(cause: string): string {
  return YAML_CAUSE_TRANSLATIONS.find((t) => cause.includes(t.match))?.es ?? cause;
}

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
    return { error: `${translateYamlCause(cause)}${position}` };
  }
  return { value: doc.toJS() };
}
