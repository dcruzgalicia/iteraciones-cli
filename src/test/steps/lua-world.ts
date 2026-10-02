import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * #2545 (onda 1) — el mundo compartido de los filtros Lua.
 *
 * Los cuatro contextos (`toLatex`, `toHtml5`, `internal/flags`,
 * `latex/07-titlepages`) cargan el caso de un fixture y comparan la salida de
 * pandoc. Eso es el MISMO mundo en cuatro archivos, y por eso vive aquí: si cada
 * step file declarara su propio `world`, el `Then` de "cumple las
 * expectativas" quedaría definido dos veces y cucumber reportaría
 * `ambiguous` en los 63 escenarios de tabla.
 *
 * Un solo `Then` compartido también evita cuatro copias de la misma comparación
 * divergiendo.
 */

const FIXTURES = join(import.meta.dir, '../../../features/fixtures/lua-filters');

export interface LuaCase {
  name: string;
  helper: 'toLatex' | 'toHtml5' | 'toLatexFlags' | 'toLatexTitleback';
  markdown: string;
  from?: string;
  contains: string[];
  notContains: string[];
  normalizeNewlines: boolean;
  /** Los casos de HTML que piden además los filtros semánticos. */
  extraSemantic?: boolean;
  /** `internal/flags` sólo emite `\printbibliography` con bibliografía real. */
  needsBib?: boolean;
}

export const world: { testCase: LuaCase | null; output: string } = { testCase: null, output: '' };

export async function loadCase(name: string): Promise<void> {
  const raw = await readFile(join(FIXTURES, `${name}.json`), 'utf8');
  world.testCase = JSON.parse(raw) as LuaCase;
}

/**
 * La comparación que hacía cada `it()` del original: `toContain` y
 * `not.toContain` sobre la salida de pandoc, en el mismo orden.
 *
 * El nombre del caso va en cada error porque en un `Esquema del escenario` de
 * treinta filas cucumber no dice cuál falló.
 */
export function checkExpectations(): void {
  const testCase = world.testCase;
  if (testCase === null) throw new Error('no se cargó ningún caso: falta el Given');
  const { contains, notContains, normalizeNewlines, name } = testCase;
  // pandoc envuelve la salida a 72 columnas; algunos casos normalizan los saltos
  // antes de comparar, igual que el original.
  const output = normalizeNewlines ? world.output.replace(/\n/g, ' ') : world.output;
  for (const expected of contains) {
    if (!output.includes(expected)) {
      throw new Error(`[${name}] esperaba ${JSON.stringify(expected)}`);
    }
  }
  for (const forbidden of notContains) {
    if (output.includes(forbidden)) {
      throw new Error(`[${name}] esperaba que la salida NO contuviera ${JSON.stringify(forbidden)}`);
    }
  }
}
