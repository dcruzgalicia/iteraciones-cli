import { parseDocument } from 'yaml';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const YAML_CAUSE_TRANSLATIONS: Array<{ match: string; es: string }> = [
  {
    match: 'All mapping items must start at the same column',
    es: 'los items del mapeo deben empezar en la misma columna (indentación inconsistente)',
  },
  {
    match: 'Implicit map keys need to be followed by map values',
    es: 'cada clave del mapeo necesita un valor después de los dos puntos (revisa la indentación)',
  },
  {
    match: 'Implicit keys need to be on a single line',
    es: 'clave de mapeo inesperada: revisa que la línea anterior tenga su valor y que la indentación sea consistente',
  },
  { match: 'Unexpected scalar at node end', es: 'contenido inesperado: revisa la indentación y que cada línea sea «clave: valor»' },
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
  {
    match: 'Block collection cannot be used as implicit map key',
    es: 'un bloque no puede usarse como clave del mapeo (falta un valor para la clave anterior)',
  },
  { match: 'unexpected end of stream', es: 'el YAML termina de forma inesperada' },
];

function translateYamlCause(cause: string): string {
  return YAML_CAUSE_TRANSLATIONS.find((t) => cause.includes(t.match))?.es ?? cause;
}

export function splitFrontmatter(content: string): { yaml?: string; body: string } {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { body: content };
  return { yaml: fmMatch[1], body: content.slice(fmMatch[0].length) };
}

export function parseYamlWithPosition(raw: string): { value?: unknown; error?: string } {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    if (!first) return { error: 'Error de sintaxis YAML' };
    const linePos = first.linePos?.[0];
    const position = linePos ? ` (línea ${linePos.line}, columna ${linePos.col})` : '';
    const cause = (first.message.split('\n')[0] ?? first.message).replace(/ at line \d+, column \d+:$/, '');
    return { error: `${translateYamlCause(cause)}${position}` };
  }
  return { value: doc.toJS() };
}
