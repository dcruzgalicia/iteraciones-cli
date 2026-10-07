import { spyOn } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { collectionBaseContent, collectionCardsContent } from '../../builder/pipeline-formats.js';
import { loadPreambleFilters } from '../../builder/preamble-loader.js';
import { validateFrontmatterFields } from '../../builder/project-validator.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

When('valido el frontmatter:', (fm: string) => {
  const errores = validateFrontmatterFields(JSON.parse(fm) as Record<string, unknown>);
  world.erroresFm = errores.filter((i) => i.severity === 'error');
});

Then('no hay errores de frontmatter', () => {
  if (world.erroresFm.length > 0) {
    throw new Error(`hubo errores: ${JSON.stringify(world.erroresFm)}`);
  }
});

Then('hay {int} errores de frontmatter', (cuantos: number) => {
  if (world.erroresFm.length !== cuantos) {
    throw new Error(`hubo ${world.erroresFm.length} errores y son ${cuantos}: ${JSON.stringify(world.erroresFm)}`);
  }
});

Then('algún error menciona {string}', (campo: string) => {
  if (!world.erroresFm.some((i) => i.message.includes(campo))) {
    throw new Error(`ningún error menciona ${JSON.stringify(campo)}: ${JSON.stringify(world.erroresFm)}`);
  }
});

When('cargo los preámbulos de {string}', async (tipo: string) => {
  const filtros = await loadPreambleFilters(undefined, undefined, tipo as Parameters<typeof loadPreambleFilters>[2]);
  world.nombresPreambulo = filtros.map((f) => f.name);
});

Then('los preámbulos cargados traen {string}', (nombre: string) => {
  if (!(world.nombresPreambulo as string[]).includes(nombre)) {
    throw new Error(`${nombre} no viene: ${JSON.stringify(world.nombresPreambulo)}`);
  }
});

Then('los preámbulos de intervention traen los mismos que los de file', () => {
  if (JSON.stringify(world.nombresPreambulo) !== JSON.stringify(world.nombresPreambuloFile)) {
    throw new Error(`intervention trae ${JSON.stringify(world.nombresPreambulo)} y file ${JSON.stringify(world.nombresPreambuloFile)}`);
  }
});

When('cargo también los preámbulos de file', async () => {
  const filtros = await loadPreambleFilters(undefined, undefined, 'file');
  world.nombresPreambuloFile = filtros.map((f) => f.name);
});

type Entrada = Parameters<typeof collectionBaseContent>[0][number];

function pareja(): Entrada[] {
  const documento: Entrada = {
    file: 'doc.md',
    creator: ['Autora A'],
    title: 'Documento',
    subtitle: undefined,
    type: 'file',
    lineLength: undefined,
    pages: undefined,
    body: 'Contenido de doc.',
  };
  return [documento, { ...documento, file: 'inter.md', type: 'intervention', body: 'regla de imprenta' }];
}

const HREFS = new Map([
  ['doc.md', './documento-por-autora-a.html'],
  ['inter.md', './regla-de-imprenta.html'],
]);

Given('una colección con un documento y una intervention', () => {
  world.entradasColeccion = pareja();
});

When('compongo las tarjetas de la colección', () => {
  world.htmlColeccion = collectionCardsContent(world.entradasColeccion as Entrada[], HREFS, '---\ntitle: Antología\n---\n\nIntro.\n');
});

When('compongo el cuerpo de la colección para {string}', (formato: string) => {
  world.cuerpoColeccion = collectionBaseContent(world.entradasColeccion as Entrada[], formato as 'html', '');
});

Then('las tarjetas incluyen {string}', (texto: string) => {
  if (!String(world.htmlColeccion).includes(texto)) {
    throw new Error(`las tarjetas no incluyen ${JSON.stringify(texto)}`);
  }
});

Then('las tarjetas no incluyen {string}', (texto: string) => {
  if (String(world.htmlColeccion).includes(texto)) {
    throw new Error(`las tarjetas incluyen ${JSON.stringify(texto)} y no deberían`);
  }
});

Then('el cuerpo incluye {string}', (texto: string) => {
  if (!String(world.cuerpoColeccion).includes(texto)) {
    throw new Error(`el cuerpo no incluye ${JSON.stringify(texto)}`);
  }
});

Then('el cuerpo no incluye {string}', (texto: string) => {
  if (String(world.cuerpoColeccion).includes(texto)) {
    throw new Error(`el cuerpo incluye ${JSON.stringify(texto)} y no deberían`);
  }
});

Given('un proyecto con una colección que incluye una intervention', () => {
  escribirEnProyecto(
    'iteraciones.config.yaml',
    ['language: es-MX', 'format:', '  html:', '    generate: true', '  epub:', '    generate: true'].join('\n'),
  );
  escribirEnProyecto(
    'coleccion.md',
    ['---', 'title: Antología', 'type: collection', 'files:', '  - doc.md', '  - regla.md', '---', '', 'Intro.', ''].join('\n'),
  );
  escribirEnProyecto('doc.md', ['---', 'title: Documento', 'creator:', '  - Autora A', '---', '', 'Contenido de doc.', ''].join('\n'));
  escribirEnProyecto('regla.md', ['---', 'title: Regla', 'type: intervention', 'pages: 1', '---', '', 'regla de imprenta', ''].join('\n'));
});

Given('un proyecto cuya colección sólo incluye interventions', () => {
  escribirEnProyecto(
    'iteraciones.config.yaml',
    ['language: es-MX', 'format:', '  html:', '    generate: true', '  epub:', '    generate: true'].join('\n'),
  );
  escribirEnProyecto('coleccion.md', ['---', 'title: Antología', 'type: collection', 'files:', '  - regla.md', '---', '', 'Intro.', ''].join('\n'));
  escribirEnProyecto('regla.md', ['---', 'title: Regla', 'type: intervention', '---', '', 'regla de imprenta', ''].join('\n'));
});

When('construyo el proyecto capturando stderr', async () => {
  const espia = spyOn(process.stderr, 'write');
  process.exitCode = 0;
  try {
    const { runBuild } = await import('../../cli/dispatcher.js');
    await runBuild(world.root);
  } finally {
    world.stderrConstruccion = espia.mock.calls.map((c) => String(c[0])).join('');
    espia.mockRestore();
    world.exitCodeConstruccion = process.exitCode;
    process.exitCode = 0;
  }
});

Then('la construcción termina con código {int}', (codigo: string) => {
  if (world.exitCodeConstruccion !== Number(codigo)) {
    throw new Error(`el código de salida es ${world.exitCodeConstruccion} y el escenario dice ${codigo}`);
  }
});

Then('el aviso de la construcción dice {string}', (texto: string) => {
  const salida = String(world.stderrConstruccion);
  if (!salida.includes(texto)) throw new Error(`el aviso no dice ${JSON.stringify(texto)}. Dice:\n${salida}`);
});

Then('la página {string} se generó', (archivo: string) => {
  if (!existsSync(join(world.root, 'dist', 'files', archivo))) throw new Error(`falta ${archivo} en dist/files`);
});

Then('la página {string} NO se generó', (archivo: string) => {
  if (existsSync(join(world.root, 'dist', 'files', archivo))) {
    throw new Error(`se generó ${archivo} y no debía`);
  }
});

Then('el HTML de la colección no contiene {string}', (texto: string) => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'antologia.html'), 'utf8');
  if (html.includes(texto)) {
    throw new Error(`la página incluye ${JSON.stringify(texto)} y no debería`);
  }
});
