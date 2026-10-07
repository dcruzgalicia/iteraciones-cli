import { spyOn } from 'bun:test';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import * as runLib from '../../lib/run.js';
import { escribirEnProyecto, tempRoot, world } from './cli-world.steps.js';

/**
 * La fase PDF: el paso que compila el `.tex` de trabajo y deja el PDF en dist.
 *
 * ## Por qué una espía y no un latexmk falso
 *
 * Lo que se verifica es la **invocación**: con qué banderas, con qué nombre de
 * job y sobre qué archivo. Una espía que pasa de largo —el `exec` de verdad se
 * ejecuta y el PDF se compila— registra exactamente los argumentos y además
 * comprueba de paso que la invocación funciona. Un `latexmk` de shell en el
 * `PATH` sería más rápido, pero Bun resuelve el binario con el entorno del
 * proceso que arrancó, no con el `process.env` que el scenario muta: el falso
 * nunca llega a ejecutarse.
 *
 * Que el PDF exista, pese como un PDF y sobreviva al replay lo comprueban los
 * features que compilan de verdad, `build-completo.feature` entre ellos.
 *
 * ## Por qué una opción por fila
 *
 * `pageNumber` tiene seis valores y cada uno compone una macro distinta. En una
 * tabla son seis filas y **un** step definition; en prosa serían seis pasos
 * nuevos y el `.feature` repetido seis veces.
 */

let espioExec: ReturnType<typeof spyOn> | undefined;

/** Los argumentos de cada llamada a latexmk, en el orden en que llegaron. */
function llamadasLatexmk(): string[][] {
  const calls: unknown[][] = espioExec?.mock.calls ?? [];
  return calls.filter((llamada) => llamada[0] === 'latexmk').map((llamada) => (llamada[1] ?? []) as string[]);
}

/**
 * El `.tex` que el build dejó en dist. Las salidas se nombran por el título del
 * documento más su autora, no por el nombre del archivo: `doc.md` con título
 * "Documento" y Ana Ruiz sale `documento-por-ana-ruiz.tex`.
 */
async function leerTexDeDist(): Promise<string> {
  const salida = Bun.file(join(world.root, 'dist', 'files', 'documento-por-ana-ruiz.tex'));
  if (!(await salida.exists())) throw new Error('el build no dejó el .tex en dist');
  return salida.text();
}

// ── Given ───────────────────────────────────────────────────────────────────

/** El proyecto mínimo de esta fase. `opciones` son líneas bajo `format.pdf`. */
function writeProject(opciones: string[]): void {
  if (!world.root) world.root = tempRoot('iteraciones-latexmk-');
  escribirEnProyecto(
    'iteraciones.config.yaml',
    ['language: es-MX', 'format:', '  latex:', '    generate: true', '  pdf:', '    generate: true', ...opciones].join('\n'),
  );
  // La fecha va en el frontmatter a propósito: sin ella, `showDate: true` cae a
  // la fecha de creación del archivo, que no es un valor comprobable.
  escribirEnProyecto(
    'doc.md',
    ['---', 'title: Documento', 'creator:', '  - Ana Ruiz', 'date: 2026-08-08', '---', '', '## Capítulo', '', 'Contenido.'].join('\n'),
  );
}

Given('un proyecto con un documento y la fase PDF activa', () => {
  writeProject([]);
  // Sin mockImplementation: el exec de verdad corre y la espía sólo anota.
  espioExec = spyOn(runLib, 'exec');
});

/**
 * Cualquier palanca de `format.pdf`, para las variaciones de una opción.
 * Cubre `pageNumber`, `showDate` y `courtesyPage` con el mismo paso.
 */
Given('un proyecto con un documento y {word}: {word}', (clave: string, valor: string) => {
  writeProject([`    ${clave}: ${valor}`]);
});

/** El proyecto con o sin bibliografía, que es lo que decide `-nobibtex`. */
Given('un proyecto con un documento y {word} bibliografía', (con: string) => {
  writeProject([]);
  espioExec = spyOn(runLib, 'exec');
  if (con === 'con') escribirEnProyecto('refs.bib', '@book{k1, title={T}}\n');
});

// ── When ────────────────────────────────────────────────────────────────────

When('compilo el proyecto entero', async () => {
  await build(world.root, { full: true });
});

// ── Then ────────────────────────────────────────────────────────────────────

Then('latexmk recibe la bandera {string}', (bandera: string) => {
  const llamadas = llamadasLatexmk();
  if (llamadas.length === 0) throw new Error('latexmk no llegó a invocarse');
  if (!llamadas.some((args) => args.includes(bandera))) {
    throw new Error(`latexmk no recibió ${bandera}. Recibió:\n${llamadas.map((a) => a.join(' ')).join('\n')}`);
  }
});

Then('latexmk no recibe la bandera {string}', (bandera: string) => {
  const llamadas = llamadasLatexmk();
  if (llamadas.length === 0) throw new Error('latexmk no llegó a invocarse');
  if (llamadas.some((args) => args.includes(bandera))) {
    throw new Error(`latexmk recibió ${bandera} y no debía. Recibió:\n${llamadas.map((a) => a.join(' ')).join('\n')}`);
  }
});

Then('latexmk compila el trabajo con nombre de job', () => {
  const llamadas = llamadasLatexmk();
  if (llamadas.length === 0) throw new Error('latexmk no llegó a invocarse');
  const conJob = llamadas.filter((args) => args.some((a) => a.startsWith('-jobname=')));
  if (conJob.length === 0) throw new Error(`ninguna llamada llevó -jobname. Recibió:\n${llamadas.map((a) => a.join(' ')).join('\n')}`);
  if (!conJob.some((args) => args.some((a) => a.endsWith('.tex')))) {
    throw new Error(`-jobname no llevaba el .tex de trabajo. Recibió:\n${conJob.map((a) => a.join(' ')).join('\n')}`);
  }
});

/**
 * El `.tex` de dist con un fragmento esperado, entrecomillado en la tabla de
 * `Ejemplos`. Cubre las palancas cuya salida es un fragmento —`\date{}`,
 * `\courtepagetrue`— sin un step por cada valor posible.
 */
Then('el .tex de dist lleva el fragmento {string}', async (fragmento: string) => {
  const texto = await leerTexDeDist();
  if (!texto.includes(fragmento)) throw new Error(`el .tex de dist no lleva ${fragmento}`);
});

Then('el .tex de dist no lleva el fragmento {string}', async (fragmento: string) => {
  const texto = await leerTexDeDist();
  if (texto.includes(fragmento)) throw new Error(`el .tex de dist no debería llevar ${fragmento}`);
});

/** `{word}` y no `{string}`: la tabla de `Ejemplos` pone la macro sin comillas. */
Then('el .tex de dist lleva la macro {word}', async (macro: string) => {
  if (!(await leerTexDeDist()).includes(macro)) throw new Error(`el .tex de dist no lleva ${macro}`);
});
