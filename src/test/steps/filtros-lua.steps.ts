import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { execPandoc } from '../../lib/pandoc-runner.js';
import { checkExpectations, loadCase, world } from './lua-world.js';

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

// Un `Given` por contexto, no uno genérico: los cuatro Reglas del feature
// comparten el `Then` pero no la entrada, y un solo `Dado el caso "<caso>"`
// haría que los 63 escenarios de tabla quedaran ambiguos.
Given('el caso de LaTeX {string}', loadCase);
Given('el caso de HTML {string}', loadCase);

When('lo convierto a LaTeX', async () => {
  const testCase = world.testCase;
  if (testCase === null) throw new Error('no se cargo ningun caso: falta el Given');
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
  if (testCase === null) throw new Error('no se cargo ningun caso: falta el Given');
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

Then('cumple las expectativas guardadas', checkExpectations);
