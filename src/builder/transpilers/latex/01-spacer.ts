import { hasClass } from '../_ast-utils.js';

/**
 * Transpiler de formato LaTeX: transforma Divs con clase .spacer (generados
 * por :: y :; en la capa semantica) a \vspace{\baselineskip}.
 *
 * Si el Div tiene ademas la clase .noindent (caso :;), agrega \noindent
 * al primer parrafo siguiente.
 *
 * Para sobrescribir en un proyecto, crear un archivo con el mismo
 * nombre en <proyecto>/transpilers/latex/01-spacer.ts.
 */

export const type = 'ast' as const;

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];
  if (!Array.isArray(blocks)) return ast;

  const newBlocks: unknown[] = [];
  let pendingNoIndent = false;

  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).t === 'Div' &&
      hasClass(block as Record<string, unknown>, 'spacer')
    ) {
      newBlocks.push({ t: 'RawBlock', c: ['latex', '\\vspace{\\baselineskip}'] });
      pendingNoIndent = hasClass(block as Record<string, unknown>, 'noindent');
    } else if (pendingNoIndent && typeof block === 'object' && block !== null && (block as Record<string, unknown>).t === 'Para') {
      // Agregar \noindent al primer parrafo despues de un spacer noindent
      const para = block as Record<string, unknown>;
      const inlines = para.c as unknown[];
      if (Array.isArray(inlines)) {
        newBlocks.push({ ...para, c: [{ t: 'RawInline', c: ['latex', '\\noindent '] }, ...inlines] });
      } else {
        newBlocks.push(block);
      }
      pendingNoIndent = false;
    } else {
      newBlocks.push(block);
      pendingNoIndent = false;
    }
  }

  ast.blocks = newBlocks;
  return ast;
}
