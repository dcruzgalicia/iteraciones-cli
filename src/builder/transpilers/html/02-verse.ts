import { blockContent, hasClass } from '../_ast-utils.js';

/**
 * Transpiler de formato HTML: transforma Divs con clase .verse a
 * <div class="verse"> con los bloques internos nativos.
 *
 * Para sobrescribir en un proyecto, crear un archivo con el mismo
 * nombre en <proyecto>/transpilers/html/02-verse.ts.
 */

export const type = 'ast' as const;

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];
  if (!Array.isArray(blocks)) return ast;

  const newBlocks: unknown[] = [];
  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).t === 'Div' &&
      hasClass(block as Record<string, unknown>, 'verse')
    ) {
      newBlocks.push({ t: 'RawBlock', c: ['html', '<div class="verse">'] });
      newBlocks.push(...blockContent(block as Record<string, unknown>));
      newBlocks.push({ t: 'RawBlock', c: ['html', '</div>'] });
    } else {
      newBlocks.push(block);
    }
  }

  ast.blocks = newBlocks;
  return ast;
}
