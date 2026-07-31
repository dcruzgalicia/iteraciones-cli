import { blockContent, hasClass } from './_ast-utils.js';

/**
 * Transpiler AST: transforma Divs con clase .flushright al entorno
 * \begin{flushright}...\end{flushright} en LaTeX.
 *
 * Emite RawBlocks de apertura/cierre alrededor de los bloques internos
 * nativos: pandoc los convierte en la misma pasada, con cero procesos extra.
 */

export const type = 'ast' as const;

function processFlushright(block: Record<string, unknown>): unknown[] {
  const content = blockContent(block);
  return [{ t: 'RawBlock', c: ['latex', '\\begin{flushright}'] }, ...content, { t: 'RawBlock', c: ['latex', '\\end{flushright}'] }];
}

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];

  const newBlocks: unknown[] = [];
  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).t === 'Div' &&
      hasClass(block as Record<string, unknown>, 'flushright')
    ) {
      newBlocks.push(...processFlushright(block as Record<string, unknown>));
    } else {
      newBlocks.push(block);
    }
  }
  ast.blocks = newBlocks;
  return ast;
}
