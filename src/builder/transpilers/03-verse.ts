import { blockContent, blocksToLatex, hasClass } from './_ast-utils.js';

/**
 * Transpiler AST: transforma Divs con clase .verse a entorno
 * \begin{verse}...\end{verse} en LaTeX.
 *
 * Convierte:
 *   ::: {.verse}
 *   Texto del poema
 *   :::
 *   → \begin{verse}
 *       Texto del poema
 *     \end{verse}
 */

export const type = 'ast' as const;

// ---------------------------------------------------------------------------
// Transformación principal del AST
// ---------------------------------------------------------------------------

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];

  const newBlocks: unknown[] = [];

  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).t === 'Div' &&
      hasClass(block as Record<string, unknown>, 'verse')
    ) {
      newBlocks.push(await processVerse(block as Record<string, unknown>));
    } else {
      newBlocks.push(block);
    }
  }

  ast.blocks = newBlocks;
  return ast;
}

async function processVerse(block: Record<string, unknown>): Promise<unknown> {
  const content = blockContent(block);
  const verseLatex = await blocksToLatex(content);
  const clean = (s: string): string => s.replace(/\n\n+/g, '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');
  const verse = clean(verseLatex);

  return { t: 'RawBlock', c: ['latex', `\\begin{verse}\n${verse}\n\\end{verse}`] };
}
