/**
 * Transpiler: convierte líneas con solo "::" en markdown a
 * \vspace{\baselineskip} en LaTeX.
 *
 * Útil para forzar espacio vertical extra entre párrafos.
 *
 * Para sobrescribir en un proyecto, crear un archivo con el mismo
 * nombre en <proyecto>/transpilers/double-colon.ts y exportar
 * una función process(body: string): string.
 */

export function process(body: string): string {
  return body.replace(/^::$/gm, '\\vspace{\\baselineskip}');
}
