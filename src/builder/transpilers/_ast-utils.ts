/**
 * Funciones auxiliares compartidas para transpilers que operan sobre
 * el AST JSON de pandoc.
 */

/** Retorna true si un bloque Div tiene la clase indicada. */
export function hasClass(block: Record<string, unknown>, cls: string): boolean {
  const c = block.c as unknown[];
  if (!Array.isArray(c) || c.length < 2) return false;
  const attrs = c[0] as unknown[];
  if (!Array.isArray(attrs) || attrs.length < 2) return false;
  const classes = attrs[1] as string[];
  return Array.isArray(classes) && classes.includes(cls);
}

/** Retorna el contenido (c[1]) de un bloque AST. */
export function blockContent(block: Record<string, unknown>): unknown[] {
  const c = block.c as unknown[];
  return Array.isArray(c) && c.length >= 2 ? (c[1] as unknown[]) : [];
}

/**
 * Escapa caracteres especiales de LaTeX en texto plano.
 * Usa un placeholder para el backslash para que las llaves de
 * \textbackslash{} no se re-escapen.
 */
export function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '@@BS@@')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/%/g, '\\%')
    .split('@@BS@@')
    .join('\\textbackslash{}');
}

function asInlines(c: unknown): unknown[] {
  return Array.isArray(c) ? (c as unknown[]) : [];
}

/**
 * Convierte inlines del AST a LaTeX sin invocar pandoc.
 * Cubre los casos habituales (Str, Space, SoftBreak, Emph, Strong, RawInline
 * y contenido plano de otros nodos). Se usa para argumentos cortos — como el
 * autor de un dictum — donde un proceso pandoc por bloque sería costoso.
 */
export function inlinesToLatex(inlines: unknown[]): string {
  let out = '';
  for (const inline of inlines) {
    if (typeof inline !== 'object' || inline === null) continue;
    const node = inline as { t: string; c?: unknown };
    switch (node.t) {
      case 'Str':
        out += escapeLatex(String(node.c ?? ''));
        break;
      case 'Space':
        out += ' ';
        break;
      case 'SoftBreak':
        out += ' ';
        break;
      case 'LineBreak':
        out += '\\\\';
        break;
      case 'Emph':
        out += `\\emph{${inlinesToLatex(asInlines(node.c))}}`;
        break;
      case 'Strong':
        out += `\\textbf{${inlinesToLatex(asInlines(node.c))}}`;
        break;
      case 'RawInline': {
        const c = node.c as unknown[];
        if (Array.isArray(c) && c[0] === 'latex') out += String(c[1] ?? '');
        break;
      }
      default:
        // Otros inlines (Code, Math, Link, Note…): usar contenido plano si existe
        if (typeof node.c === 'string') out += escapeLatex(node.c);
    }
  }
  return out;
}
