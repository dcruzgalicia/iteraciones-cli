import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, When } from '@cucumber/cucumber';
import { execPandoc } from '../../lib/pandoc-runner.js';
import { setFlagsContext } from './filtros-lua-flags.steps.js';
import { loadCase, world as luaWorld } from './lua-world.js';

/**
 * #2545 (onda 1) — contextos con template propio: `internal/flags` y
 * `latex/07-titlepages`.
 *
 * ## Por qué estos necesitan más que el helper `execPandoc`
 *
 * Los filtros de `flags` y de `titlepages` leen condicionales del TEMPLATE
 * (`$if(has-toc-entries)$…$endif$`) y `flags` además necesita un `.bib` real
 * para decidir si inserta `\printbibliography`. Por eso se arma un template y
 * una bibliografía en un directorio temporal, igual que el `beforeAll` del
 * original — pero por escenario, porque cucumber no da try/finally.
 *
 * ## El caso del `.bib`
 *
 * `flags.lua` sólo emite `\printbibliography` si hay citas **y** bibliografía
 * efectiva. El fixture marca `needsBib` y el step añade `--biblatex
 * --bibliography <path>`; sin ese flag la mitad de los casos comprobaría otra
 * cosa.
 */

const FILTERS = join(import.meta.dir, '../../lib/resources/filters');
const FLAGS = join(FILTERS, 'internal', 'flags.lua');
const TITLEPAGES = join(FILTERS, 'latex', '07-titlepages.lua');

/** El template que el `beforeAll` del original escribía para `flags`. */
const FLAGS_TEMPLATE = [
  '\\documentclass{article}',
  '$if(has-toc-entries)$\\tableofcontents$endif$',
  '$if(skip-paragraph-space)$$else$\\vspace*{2\\baselineskip}$endif$',
  '$body$',
  '\\end{document}',
  '',
].join('\n');

const BIB = '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n';

/**
 * El directorio temporal con el template y el `.bib`. Es lo que el `beforeAll`
 * del original montaba una vez por bloque; aquí se hace una vez por corrida y
 * `After` lo borra, porque cucumber no da try/finally por escenario.
 *
 * OJO: esto NO es el `world` de los casos — ése vive en `lua-world.ts`. Aquí sólo
 * viven las rutas de los archivos de apoyo.
 */
interface ContextWorld {
  dir: string;
  flagsTemplate: string;
  titlebackTemplate: string;
  bib: string;
}

const world: ContextWorld = { dir: '', flagsTemplate: '', titlebackTemplate: '', bib: '' };

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  world.flagsTemplate = join(world.dir, 'flags.tex');
  await writeFile(world.flagsTemplate, FLAGS_TEMPLATE);
  world.titlebackTemplate = join(world.dir, 'titleback.tex');
  // El template de titlepages tiene que declarar UNA CONDICIONAL POR CAMPO: es
  // justamente ahí donde el filtro deposita el valor serializado, así que un
  // template simplificado hace que el filtro convierta bien y la salida salga
  // vacía. Va copiado literal del original.
  await writeFile(
    world.titlebackTemplate,
    [
      '\\documentclass{article}',
      '$if(subtitle)$\\subtitle{$subtitle$}$endif$',
      '$if(extratitle)$\\extratitle{$extratitle$}$endif$',
      '$if(frontispiece)$\\frontispiece{$frontispiece$}$endif$',
      '$if(titlehead)$\\titlehead{$titlehead$}$endif$',
      '$if(subject)$\\subject{$subject$}$endif$',
      '$if(dedication)$\\dedication{$dedication$}$endif$',
      '$if(uppertitleback)$\\uppertitleback{$uppertitleback$}$endif$',
      '$if(lowertitleback)$\\lowertitleback{$lowertitleback$}$endif$',
      '$if(publishers)$\\publishers{$publishers$}$endif$',
      '$if(publisherImage)$\\publishersimage{$publisherImage$}$endif$',
      '$if(startpaper)$\\setstartpaper{$startpaper$}$endif$',
      '$if(colophon)$\\colophon{$colophon$}$endif$',
      '$if(collectionCreator)$\\collectionCreator{$for(collectionCreator)$\\mbox{$collectionCreator$}$sep$ \\and $endfor$}$endif$',
      '$if(titleImage)$\\titleimage{$titleImage$}$endif$',
      '$body$',
      '\\end{document}',
      '',
    ].join('\n'),
  );
  world.bib = join(world.dir, 'refs.bib');
  await writeFile(world.bib, BIB);
  // Los steps de los casos con nombre necesitan las mismas rutas.
  setFlagsContext(world.flagsTemplate, world.bib);
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

Given('el caso de flags {string}', loadCase);
Given('el caso de páginas de título {string}', loadCase);

When('lo convierto con el filtro de flags', async () => {
  const testCase = luaWorld.testCase;
  if (testCase === null) throw new Error('no se cargo ningun caso: falta el Given');
  const extra = testCase.needsBib ? ['--biblatex', '--bibliography', world.bib] : [];
  luaWorld.output = await execPandoc({
    input: testCase.markdown,
    sourcePath: 'test.md',
    to: 'latex',
    extraArgs: ['--template', world.flagsTemplate, '--lua-filter', FLAGS, ...extra],
  });
});

When('lo convierto con el filtro de páginas de título', async () => {
  if (luaWorld.testCase === null) throw new Error('no se cargo ningun caso: falta el Given');
  luaWorld.output = await execPandoc({
    input: luaWorld.testCase.markdown,
    sourcePath: 'test.md',
    to: 'latex',
    extraArgs: ['--template', world.titlebackTemplate, '--lua-filter', TITLEPAGES],
  });
});
