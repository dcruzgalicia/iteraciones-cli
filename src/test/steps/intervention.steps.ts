import { spyOn } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { collectionBaseContent, collectionCardsContent } from '../../builder/pipeline-formats.js';
import { loadPreambleFilters } from '../../builder/preamble-loader.js';
import { validateFrontmatterFields } from '../../builder/project-validator.js';
import { capture, escribirEnProyecto, world } from './cli-world.steps.ts';

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
    posicion: 1,
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

Given('una intervention con membrete de {int} imágenes y {int} páginas', (cuantas: number, paginas: number) => {
  escribirEnProyecto(
    'iteraciones.config.yaml',
    ['language: es-MX', 'format:', '  latex:', '    generate: true', '  pdf:', '    generate: true'].join('\n'),
  );
  const tam = [
    [120, 80],
    [80, 120],
    [120, 40],
  ] as const;
  const rutas: string[] = [];
  for (let i = 1; i <= cuantas; i++) {
    const [w, h] = tam[(i - 1) % tam.length] ?? tam[0];
    mkdirSync(join(world.root, 'img'), { recursive: true });
    const creada = Bun.spawnSync(['magick', '-size', `${w}x${h}`, 'xc:black', join(world.root, 'img', `i${i}.png`)]);
    if (creada.exitCode !== 0) throw new Error('magick no pudo crear la imagen de membrete');
    rutas.push(`  - img/i${i}.png`);
  }
  escribirEnProyecto(
    'regla.md',
    ['---', 'type: intervention', `pages: ${paginas}`, 'letterhead:', ...rutas, '---', '', 'Escribe tu propio texto.', ''].join('\n'),
  );
});

When('compilo el proyecto con PDF', async () => {
  await capture(() => build(world.root, {}));
});

Then('el .tex de la intervention llama al membrete con {string}, {string} y {string}', (a: string, b: string, c: string) => {
  const tex = readFileSync(join(world.root, 'dist', 'files', 'regla.tex'), 'utf8');
  const llamada = /\\letterheadsetup\{([^}]*)\}/.exec(tex)?.[1] ?? '';
  const partes = llamada.split(',').map((p) => basename(p));
  const esperadas = [a, b, c].map((n) => `${n}.jpg`);
  if (partes.length !== esperadas.length || !esperadas.every((n, i) => partes[i] === n)) {
    throw new Error(`el membrete va como ${JSON.stringify(partes)} y esperaba ${JSON.stringify(esperadas)}`);
  }
});

/** La caja de la imagen de membrete: va en la banda inferior de la hoja. */
interface Membrete {
  x: number;
  w: number;
  h: number;
  abajo: number;
}

function mideMembrete(archivo: string): Membrete {
  const tam = Bun.spawnSync(['magick', 'identify', '-format', '%wx%h', archivo]).stdout.toString();
  const [ancho, alto] = tam.split('x').map(Number) as [number, number];
  const banda = 320;
  const caja = Bun.spawnSync([
    'magick',
    archivo,
    '-crop',
    `${ancho}x${banda}+0+${alto - banda}`,
    '+repage',
    '-threshold',
    '90%',
    '-format',
    '%@',
    'info:',
  ]).stdout.toString();
  const m = /(\d+)x(\d+)\+(\d+)\+(\d+)/.exec(caja);
  if (m === null) throw new Error(`no encontré el membrete en ${archivo}: ${JSON.stringify(caja)}`);
  const [, w, h, x, y] = m;
  return { x: Number(x), w: Number(w), h: Number(h), abajo: alto - banda + Number(y) + Number(h) };
}

When('mido el membrete de cada página', () => {
  const pdf = join(world.root, 'dist', 'files', 'regla.pdf');
  const tmp = join(world.root, 'paginas');
  mkdirSync(tmp, { recursive: true });
  const proc = Bun.spawnSync(['pdftoppm', '-r', '150', '-png', pdf, join(tmp, 'p')]);
  if (proc.exitCode !== 0) throw new Error(`pdftoppm falló: ${proc.stderr.toString()}`);
  const paginas = readdirSync(tmp)
    .filter((f) => f.endsWith('.png'))
    .sort();
  world.membrete = paginas.map((f) => mideMembrete(join(tmp, f)));
});

function membreteDe(pagina: number): Membrete {
  const lista = world.membrete as Membrete[];
  const medida = lista[pagina - 1];
  if (medida === undefined) throw new Error(`no hay membrete medido en la página ${pagina}`);
  return medida;
}

Then('la página {int} lleva el membrete a la {word} y abajo', (pagina: number, lado: string) => {
  const m = membreteDe(pagina);
  const derecha = m.x + m.w;
  const borde = lado === 'derecha' ? derecha : m.x;
  // Carta a 150 dpi: márgenes de 2.54 cm = 150 px.
  if (Math.abs(borde - (lado === 'derecha' ? 1125 : 150)) > 12) {
    throw new Error(`el membrete de la página ${pagina} queda en x=${borde} y debía quedar a la ${lado}`);
  }
  if (Math.abs(m.abajo - 1500) > 12) {
    throw new Error(`el membrete de la página ${pagina} termina en y=${m.abajo} y debía terminar en el pie de la caja (1500)`);
  }
});

Then('la página {int} repite la imagen de la página {int}', (una: number, otra: number) => {
  const a = membreteDe(una);
  const b = membreteDe(otra);
  if (Math.abs(a.h - b.h) > 2 || Math.abs(a.w - b.w) > 2) {
    throw new Error(`la página ${una} (${a.w}x${a.h}) y la ${otra} (${b.w}x${b.h}) no llevan la misma imagen`);
  }
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
