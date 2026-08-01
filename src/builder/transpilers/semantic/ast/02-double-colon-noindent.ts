/**
 * Transpiler AST semántico: convierte parrafos con solo ":;" en markdown a
 * un `Div` con clases `spacer noindent` — sin contenido de formato específico.
 *
 * El AST resultante es semántico: el exportador latex lo convierte a
 * \vspace{\baselineskip} + \noindent en el párrafo siguiente; html lo ignora
 * (la sangría de párrafo es un concepto de LaTeX).
 *
 * Se usa AST en lugar de string porque es mas confiable marcar el siguiente
 * bloque que usar \@afterindentfalse\@afterheading (que activa \@nobreaktrue
 * y puede romper beforeskip de secciones).
 *
 * Para sobrescribir en un proyecto, crear un archivo con el mismo
 * nombre en <proyecto>/transpilers/semantic/ast/02-double-colon-noindent.ts.
 */

export const type = 'ast' as const;

/** Retorna true si el bloque es un Para cuyo unico contenido es ":;". */
function isColonSemicolonPara(block: unknown): boolean {
  if (!block || typeof block !== 'object') return false;
  const rec = block as Record<string, unknown>;
  if (rec.t !== 'Para') return false;
  const inlines = rec.c as unknown[];
  if (!Array.isArray(inlines) || inlines.length !== 1) return false;
  const inline = inlines[0] as Record<string, unknown> | undefined;
  return typeof inline === 'object' && inline !== null && inline.t === 'Str' && inline.c === ':;';
}

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];
  if (!Array.isArray(blocks)) return ast;

  const newBlocks: unknown[] = [];
  for (const block of blocks) {
    if (isColonSemicolonPara(block)) {
      newBlocks.push({ t: 'Div', c: [['', ['spacer', 'noindent'], []], []] });
    } else {
      newBlocks.push(block);
    }
  }

  ast.blocks = newBlocks;
  return ast;
}
