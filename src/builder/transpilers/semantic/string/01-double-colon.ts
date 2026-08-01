/**
 * Transpiler de string semántico: convierte líneas con solo "::" en markdown
 * a un fenced div `::: {.spacer}` — sin contenido de formato específico.
 *
 * El AST resultante (Div.spacer) es semántico: cada exportador lo convierte
 * a su formato (latex → \vspace{\baselineskip}, html → <div class="spacer">).
 *
 * Útil para forzar espacio vertical extra entre párrafos.
 *
 * Para sobrescribir en un proyecto, crear un archivo con el mismo
 * nombre en <proyecto>/transpilers/semantic/string/01-double-colon.ts
 * y exportar una función process(body: string): string.
 */

export const type = 'string' as const;

export function process(body: string): string {
  return body.replace(/^::$/gm, '::: {.spacer}\n:::');
}
