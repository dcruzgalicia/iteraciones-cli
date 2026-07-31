/**
 * Transpiler de string: convierte líneas con solo ":;" en markdown a
 * \vspace{\baselineskip}\@afterindentfalse\@afterheading en LaTeX.
 *
 * Útil para forzar espacio vertical extra entre párrafos Y eliminar
 * la sangría del párrafo siguiente.
 *
 * Para sobrescribir en un proyecto, crear un archivo con el mismo
 * nombre en <proyecto>/transpilers/02-double-colon-noindent.ts y exportar
 * una función process(body: string): string.
 */

export const type = 'string' as const;

export function process(body: string): string {
  return body.replace(/^:;$/gm, '\\vspace{\\baselineskip}\\@afterindentfalse\\@afterheading');
}
