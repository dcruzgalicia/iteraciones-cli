import { spyOn } from 'bun:test';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import * as runLib from '../../lib/run.js';
import { escribirEnProyecto, tempRoot, world } from './cli-world.steps.js';

let espioExec: ReturnType<typeof spyOn> | undefined;

function llamadasLatexmk(): string[][] {
  const calls: unknown[][] = espioExec?.mock.calls ?? [];
  return calls.filter((llamada) => llamada[0] === 'latexmk').map((llamada) => (llamada[1] ?? []) as string[]);
}

async function leerTexDeDist(): Promise<string> {
  const salida = Bun.file(join(world.root, 'dist', 'files', 'documento-por-ana-ruiz.tex'));
  if (!(await salida.exists())) throw new Error('el build no dejó el .tex en dist');
  return salida.text();
}

function writeProject(opciones: string[]): void {
  if (!world.root) world.root = tempRoot('iteraciones-latexmk-');
  escribirEnProyecto(
    'iteraciones.config.yaml',
    ['language: es-MX', 'format:', '  latex:', '    generate: true', '  pdf:', '    generate: true', ...opciones].join('\n'),
  );

  escribirEnProyecto(
    'doc.md',
    ['---', 'title: Documento', 'creator:', '  - Ana Ruiz', 'date: 2026-08-08', '---', '', '## Capítulo', '', 'Contenido.'].join('\n'),
  );
}

Given('un proyecto con un documento y la fase PDF activa', () => {
  writeProject([]);

  espioExec = spyOn(runLib, 'exec');
});

Given('un proyecto con un documento y {word}: {word}', (clave: string, valor: string) => {
  writeProject([`    ${clave}: ${valor}`]);
});

Given('un proyecto con un documento y {word} bibliografía', (con: string) => {
  writeProject([]);
  espioExec = spyOn(runLib, 'exec');
  if (con === 'con') escribirEnProyecto('refs.bib', '@book{k1, title={T}}\n');
});

When('compilo el proyecto entero', async () => {
  await build(world.root, { full: true });
});

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

Then('el .tex de dist lleva el fragmento {string}', async (fragmento: string) => {
  const texto = await leerTexDeDist();
  if (!texto.includes(fragmento)) throw new Error(`el .tex de dist no lleva ${fragmento}`);
});

Then('el .tex de dist no lleva el fragmento {string}', async (fragmento: string) => {
  const texto = await leerTexDeDist();
  if (texto.includes(fragmento)) throw new Error(`el .tex de dist no debería llevar ${fragmento}`);
});

Then('el .tex de dist lleva la macro {word}', async (macro: string) => {
  if (!(await leerTexDeDist()).includes(macro)) throw new Error(`el .tex de dist no lleva ${macro}`);
});
