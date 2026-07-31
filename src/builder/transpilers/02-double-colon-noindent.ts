/**
 * Transpiler AST: convierte parrafos con solo ":;" en markdown a
 * \vspace{\baselineskip} en LaTeX y agrega \noindent al siguiente
 * parrafo.
 *
 * Útil para forzar espacio vertical extra entre párrafos Y eliminar
 * la sangría del párrafo siguiente.
 *
 * Se usa AST en lugar de string porque:
 * - \@ no es reconocido por pandoc como comando LaTeX
 * - Es mas confiable agregar \noindent al primer inline del siguiente
 *   parrafo (como en dictum) que usar \@afterindentfalse\@afterheading
 *   que activa \@nobreaktrue y puede romper beforeskip de secciones.
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
  let pendingNoIndent = false;

  for (const block of blocks) {
    if (isColonSemicolonPara(block)) {
      newBlocks.push({ t: 'RawBlock', c: ['latex', '\\vspace{\\baselineskip}'] });
      pendingNoIndent = true;
    } else if (pendingNoIndent && typeof block === 'object' && block !== null && (block as Record<string, unknown>).t === 'Para') {
      // Agregar \noindent al primer parrafo despues de :;
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
