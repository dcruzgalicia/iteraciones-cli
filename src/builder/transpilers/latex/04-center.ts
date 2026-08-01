import { blockContent, hasClass } from '../_ast-utils.js';

/**
 * Transpiler AST: transforma Divs con clase .center al entorno
 * \begin{center}...\end{center} en LaTeX.
 *
 * Emite RawBlocks de apertura/cierre alrededor de los bloques internos
 * nativos: pandoc los convierte en la misma pasada, con cero procesos extra.
 */

export const type = 'ast' as const;

function processCenter(block: Record<string, unknown>): unknown[] {
  const content = blockContent(block);
  return [{ t: 'RawBlock', c: ['latex', '\\begin{center}'] }, ...content, { t: 'RawBlock', c: ['latex', '\\end{center}'] }];
}

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];

  const newBlocks: unknown[] = [];
  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).t === 'Div' &&
      hasClass(block as Record<string, unknown>, 'center')
    ) {
      newBlocks.push(...processCenter(block as Record<string, unknown>));
    } else {
      newBlocks.push(block);
    }
  }
  ast.blocks = newBlocks;
  return ast;
}
