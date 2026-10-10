import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dir, '../../../features/fixtures/lua-filters');

export interface LuaCase {
  name: string;
  helper: 'toLatex' | 'toHtml5' | 'toLatexFlags' | 'toLatexTitleback';
  markdown: string;
  from?: string;
  contains: string[];
  notContains: string[];
  normalizeNewlines: boolean;

  extraSemantic?: boolean;

  filters?: string[];

  needsBib?: boolean;
}

export const world: { testCase: LuaCase | null; output: string } = { testCase: null, output: '' };

export async function loadCase(name: string): Promise<void> {
  const raw = await readFile(join(FIXTURES, `${name}.json`), 'utf8');
  world.testCase = JSON.parse(raw) as LuaCase;
}

export function checkExpectations(): void {
  const testCase = world.testCase;
  if (testCase === null) throw new Error('no se cargó ningún caso: falta el Given');
  const { contains, notContains, normalizeNewlines, name } = testCase;

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
