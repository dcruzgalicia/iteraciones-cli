import { blockContent, hasClass } from '../_ast-utils.js';

/**
 * Transpiler AST: transforma Divs con clase .verse a entorno
 * \begin{verse}...\end{verse} en LaTeX, con espacio superior e inferior
 * configurables mediante atributos beforeskip y afterskip.
 *
 * Si despues de un verse sigue un parrafo normal, le antepone
 * \noindent para evitar sangria.
 *
 * Se ejecuta sobre el JSON AST de pandoc (despues del parseo inicial).
 *
 * Convierte:
 *   ::: {.verse}
 *   Texto del poema
 *   :::
 *   → \vspace*{3pt}\begin{verse}
 *       Texto del poema
 *     \end{verse}\vspace*{3pt}
 *
 *   ::: {.verse beforeskip="1\\baselineskip" afterskip="24pt"}
 *   Texto del poema
 *   :::
 *   → \vspace*{1\baselineskip}\begin{verse}
 *       Texto del poema
 *     \end{verse}\vspace*{24pt}
 *
 * En lugar de convertir el contenido interno con un proceso pandoc por
 * bloque (blocksToLatex), se emiten RawBlocks de apertura/cierre alrededor
 * de los bloques internos nativos: pandoc los convierte en la misma pasada,
 * con cero procesos extra.
 */

export const type = 'ast' as const;

// ---------------------------------------------------------------------------
// Procesar un Div.verse → \begin{verse}...\end{verse} con bloques nativos
// ---------------------------------------------------------------------------

function processVerse(block: Record<string, unknown>): unknown[] {
  const content = blockContent(block);

  // Leer atributos del fenced div: {.verse beforeskip="..." afterskip="..."}
  const c = block.c as unknown[];
  const attrs = Array.isArray(c) && c.length >= 1 ? (c[0] as unknown[]) : [];
  const kvPairs: [string, string][] = Array.isArray(attrs) && attrs.length >= 3 ? (attrs[2] as [string, string][]) : [];
  const getAttr = (key: string, fallback: string): string => (Array.isArray(kvPairs) ? kvPairs.find(([k]) => k === key)?.[1] : undefined) ?? fallback;

  const beforeskip = getAttr('beforeskip', '3pt');
  const afterskip = getAttr('afterskip', '3pt');

  return [
    { t: 'RawBlock', c: ['latex', `\\vspace*{${beforeskip}}\\begin{verse}`] },
    ...content,
    { t: 'RawBlock', c: ['latex', `\\end{verse}\\vspace*{${afterskip}}`] },
  ];
}

// ---------------------------------------------------------------------------
// Transformación principal del AST
// ---------------------------------------------------------------------------

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];

  const newBlocks: unknown[] = [];
  let lastWasVerse = false;

  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).t === 'Div' &&
      hasClass(block as Record<string, unknown>, 'verse')
    ) {
      newBlocks.push(...processVerse(block as Record<string, unknown>));
      lastWasVerse = true;
    } else if (lastWasVerse && typeof block === 'object' && block !== null && (block as Record<string, unknown>).t === 'Para') {
      // Agregar \noindent al primer parrafo despues de un verse
      const para = block as Record<string, unknown>;
      const inlines = para.c as unknown[];
      if (Array.isArray(inlines)) {
        newBlocks.push({ ...para, c: [{ t: 'RawInline', c: ['latex', '\\noindent '] }, ...inlines] });
      } else {
        newBlocks.push(block);
      }
      lastWasVerse = false;
    } else {
      newBlocks.push(block);
      lastWasVerse = false;
    }
  }

  ast.blocks = newBlocks;
  return ast;
}
