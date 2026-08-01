import { hasClass } from '../_ast-utils.js';

/**
 * Transpiler de formato HTML: transforma Divs con clase .spacer (generados
 * por :: y :; en la capa semantica) a <div class="spacer"></div>.
 *
 * La clase .noindent no aplica en HTML (la sangria de parrafo es LaTeX-only).
 *
 * Para sobrescribir en un proyecto, crear un archivo con el mismo
 * nombre en <proyecto>/transpilers/html/05-spacer.ts.
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
      hasClass(block as Record<string, unknown>, 'spacer')
    ) {
      newBlocks.push({ t: 'RawBlock', c: ['html', '<div class="spacer"></div>'] });
    } else {
      newBlocks.push(block);
    }
  }

  ast.blocks = newBlocks;
  return ast;
}
