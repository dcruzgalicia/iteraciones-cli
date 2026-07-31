/**
 * Transpiler AST: convierte parrafos con solo ":;" en markdown a
 * \vspace{\baselineskip}\@afterindentfalse\@afterheading en LaTeX.
 *
 * Útil para forzar espacio vertical extra entre párrafos Y eliminar
 * la sangría del párrafo siguiente.
 *
 * Se usa AST en lugar de string porque pandoc (markdown) no reconoce
 * \@ como comando LaTeX y consume la barra invertida como escape.
 * Un RawBlock preserva el contenido tal cual.
 *
 * Para sobrescribir en un proyecto, crear un archivo con el mismo
 * nombre en <proyecto>/transpilers/02-double-colon-noindent.ts.
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
      newBlocks.push({ t: 'RawBlock', c: ['latex', '\\vspace{\\baselineskip}\\@afterindentfalse\\@afterheading'] });
    } else {
      newBlocks.push(block);
    }
  }

  ast.blocks = newBlocks;
  return ast;
}
