import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { execPandoc } from '../../lib/pandoc-runner.js';

/**
 * #2545 (onda 1) — los casos de `lua-filters` que son tabla pura.
 *
 * ## Por qué fixtures y no `Examples` con el markdown dentro
 *
 * El markdown de entrada tiene saltos de línea y las expectativas son cadenas
 * de LaTeX con barras invertidas (`\\vspace{\\baselineskip}`). En una celda de
 * tabla eso es ilegible y frágil. El issue lo recomienda explícitamente: el
 * `Examples` lleva sólo el NOMBRE del caso, y los datos viven en
 * `features/fixtures/lua-filters/<caso>.json`.
 *
 * El resultado es la tabla que se puede leer de un vistazo — una línea por caso —
 * con los datos completos a un `cat` de distancia.
 *
 * ## Por qué esto no es una tabla de markdown
 *
 * Porque el markdown tiene saltos de línea. Una celda no puede ser multi-línea. La
 * alternativa —meter `\n` escapados en la celda— produce una tabla donde el
 * caso es más difícil de leer que el JSON.
 *
 * ## La verificación es la misma que hacía el original
 *
 * `toContain` / `not.toContain` sobre la salida de pandoc, en el mismo orden. Los
 * 37 casos se extrajeron mecánicamente del `it()` original, así que si la
 * extracción hubiera perdido una expectativa, el escenario falla — no puede
 * pasar en verde probando menos.
 */

const FIXTURES = join(import.meta.dir, '../../../features/fixtures/lua-filters');
const FILTERS = join(import.meta.dir, '../../lib/resources/filters');

const SEMANTIC_FILTERS = [
  join(FILTERS, 'semantic', 'string', '01-double-colon.lua'),
  join(FILTERS, 'semantic', 'ast', '02-double-colon-noindent.lua'),
];

/**
 * Las listas de filtros NO son una suposición: son las mismas del
 * `lua-filters.test.ts` original, en el mismo orden, que importa porque
 * `06-mbox-sentence-end` depende de qué se ejecutó antes.
 */
const LATEX_FILTERS = [
  '01-spacer',
  '02-dictum',
  '03-verse',
  '04-center',
  '05-flushright',
  '06-mbox-sentence-end',
  '09-quote-noindent',
  '10-cjk',
  '07-titlepages',
  '11-uppercase',
].map((name) => join(FILTERS, 'latex', `${name}.lua`));

const HTML_FILTERS = ['01-dictum', '02-verse', '03-center', '04-flushright', '05-spacer'].map((name) => join(FILTERS, 'html', `${name}.lua`));

interface LuaCase {
  name: string;
  helper: 'toLatex' | 'toHtml5';
  markdown: string;
  from?: string;
  contains: string[];
  notContains: string[];
  normalizeNewlines: boolean;
  /** Los casos de HTML que piden además los filtros semánticos. */
  extraSemantic?: boolean;
}

interface LuaWorld {
  testCase: LuaCase;
  output: string;
}

const world: LuaWorld = {
  testCase: { name: '', helper: 'toLatex', markdown: '', contains: [], notContains: [], normalizeNewlines: false },
  output: '',
};

Given('el caso {string}', async (name: string) => {
  const raw = await readFile(join(FIXTURES, `${name}.json`), 'utf8');
  world.testCase = JSON.parse(raw) as LuaCase;
});

When('lo convierto a LaTeX', async () => {
  const testCase = world.testCase;
  // Los semánticos PRIMERO: son los que convierten `::` y `:;` en Div.spacer.
  // Sin ellos, `01-spacer` y `05-spacer` no tienen nada que hacer y los seis
  // casos del separador salen como markdown crudo.
  const extraArgs = [...SEMANTIC_FILTERS, ...LATEX_FILTERS].flatMap((f) => ['--lua-filter', f]);
  world.output = await execPandoc({
    input: testCase.markdown,
    sourcePath: 'test.md',
    to: 'latex',
    from: testCase.from,
    extraArgs,
  });
});

When('lo convierto a HTML', async () => {
  const testCase = world.testCase;
  // Los semánticos van primero y sólo en los casos que los piden, igual que el
  // segundo argumento de `toHtml5(markdown, extraFilters)` del original.
  const extra = testCase.extraSemantic === true ? SEMANTIC_FILTERS : [];
  const extraArgs = [...extra, ...HTML_FILTERS].flatMap((f) => ['--lua-filter', f]);
  world.output = await execPandoc({
    input: testCase.markdown,
    sourcePath: 'test.md',
    to: 'html5',
    extraArgs,
  });
});

Then('cumple las expectativas guardadas', () => {
  // El nombre del caso va en cada error: en un `Esquema del scenario` con 30
  // filas, cucumber no dice WHICH fila falló.
  const { contains, notContains, normalizeNewlines, name } = world.testCase;
  // pandoc envuelve la salida a 72 columnas; algunos casos normalizan los saltos
  // antes de comparar, igual que el original.
  const output = normalizeNewlines ? world.output.replace(/\n/g, ' ') : world.output;
  for (const expected of contains) {
    if (!output.includes(expected)) {
      throw new Error(`[${name}] esperaba que la salida contuviera ${JSON.stringify(expected)}`);
    }
  }
  for (const forbidden of notContains) {
    if (output.includes(forbidden)) {
      throw new Error(`[${name}] esperaba que la salida NO contuviera ${JSON.stringify(forbidden)}`);
    }
  }
});
