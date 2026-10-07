import { cpSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { localizeDistAssets, relativizeTexForDist } from '../../builder/latex-composer.js';
import { build } from '../../builder/orchestrator.js';
import { loadSiteConfig } from '../../config/config-loader.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — `bundle: true` (#2448) y las rutas del `.tex` (#2450).
 *
 * ## Qué promete `bundle`
 *
 * Que una **copia de `dist/files`** vuelva a construir el mismo build. Sin
 * bundle, esa copia es inservible: el `.tex` apunta a `/proyecto/preamble/…` y
 * en la copia esa ruta no existe. Bundle replica en la salida los cuatro insumos
 * de los que dependen las salidas —config, `preamble`, `filters` y
 * bibliografía— para que la copia se sostenga sola.
 *
 * ## El `.tex` de `dist` no puede llevar rutas absolutas
 *
 * Un PDF con `\includegraphics{/home/david/proyecto/.iteraciones/…}` no se
 * puede compilar en la máquina del impresor. Bundle no arregla eso: lo
 * relativiza.
 *
 * ## El manifiesto vive en la caché, no en `dist`
 *
 * `.iteraciones/bundle.json` dice qué se copió para poder retirarlo después.
 * Si viviera en `dist`, la copia de `dist/files` se traería el manifiesto de
 * otro proyecto y `bundle: false` no sabría qué borrar.
 */

const REPLICADOS = ['iteraciones.config.yaml', 'preamble/04-margins.tex', 'filters/mi-filtro.lua', 'bibliography.bib'];

const DOC = ['---', 'title: Ensayo', '---', '', '## Capítulo', '', 'Contenido.'].join('\n');

const raiz = (): string => realpathSync(world.root);
const salida = (): string => join(raiz(), 'dist', 'files');

function configCon(lines: string[], bundle = true): string {
  return [
    'language: es-MX',
    'script: true',
    ...(bundle ? ['bundle: true'] : []),
    'format:',
    '  html:',
    '    site:',
    '      title: T',
    '    generate: true',
    '  markdown:',
    '    generate: true',
    ...lines,
  ].join('\n');
}

/** El proyecto con los cuatro insumos que bundle debe replicar. */
Given('un proyecto con los cuatro insumos', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${configCon([])}\n`);
  escribirEnProyecto('ensayo.md', `${DOC}\n`);
  escribirEnProyecto('preamble/04-margins.tex', '% margenes propios\n');
  escribirEnProyecto('filters/mi-filtro.lua', 'function Pandoc(doc) return doc end\n');
  escribirEnProyecto('bibliography.bib', '@book{ruiz2026, title = {Cuidar}},\n');
});

Given('un proyecto con bundle {string}', (estado: string) => {
  escribirEnProyecto('iteraciones.config.yaml', `${configCon([], estado === 'true')}\n`);
});

Given('el proyecto tiene un QR en el ensayo', () => {
  // Sin LaTeX no hay `.tex` que revisar, así que este proyecto lo pide.
  escribirEnProyecto('iteraciones.config.yaml', `${configCon(['  latex:', '    generate: true'])}\n`);
  escribirEnProyecto('ensayo.md', `${DOC.replace('Contenido.', '[https://historikas.com]{.qr width="15mm"}')}\n`);
});

/** Apagar bundle no borra las salidas: sólo deja de replicar. */
Given('el proyecto apaga bundle', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${configCon([], false)}\n`);
});

Given('una copia de la salida', () => {
  cpSync(salida(), join(world.root, 'copia'), { recursive: true });
});

When('construyo el proyecto con bundle', async () => {
  try {
    await build(world.root);
  } catch (e) {
    // El LaTeX puede faltar en la máquina; el error se comprueba en otro
    // escenario y aquí no debe enmascarar la aserción del .tex.
    world.errorBuild = e instanceof Error ? e.message : String(e);
  }
});

When('construyo la copia desde cero', async () => {
  await build(join(world.root, 'copia'), { full: true });
});

Then('bundle queda {string}', async (esperado: string) => {
  const leido = (await loadSiteConfig(world.root)).bundle;
  if (leido !== (esperado === 'true')) {
    throw new Error(`bundle es ${String(leido)} y el escenario dice ${esperado}`);
  }
});

Then('la salida tiene una réplica de cada insumo', () => {
  const faltan = REPLICADOS.filter((rel) => !existsSync(join(salida(), rel)));
  if (faltan.length > 0) throw new Error(`no se replicaron: ${JSON.stringify(faltan)}`);
});

Then('la salida NO tiene una réplica de cada insumo', () => {
  const sobran = REPLICADOS.filter((rel) => existsSync(join(salida(), rel)));
  if (sobran.length > 0) throw new Error(`siguen ahí: ${JSON.stringify(sobran)}`);
});

Then('el manifiesto NO está en la salida', () => {
  if (existsSync(join(salida(), '.iteraciones', 'bundle.json'))) {
    throw new Error('el manifiesto está en dist: la copia de dist/files arrastraría el de otro proyecto');
  }
});

Then('el manifiesto está en la caché del proyecto', () => {
  if (!existsSync(join(raiz(), '.iteraciones', 'bundle.json'))) {
    throw new Error('falta el manifiesto en .iteraciones');
  }
});

Then('el manifiesto ya no está en la caché', () => {
  if (existsSync(join(raiz(), '.iteraciones', 'bundle.json'))) {
    throw new Error('el manifiesto sigue ahí después de apagar bundle');
  }
});

Then('las salidas siguen en pie', () => {
  if (!existsSync(join(salida(), 'ensayo.md'))) {
    throw new Error('bundle: false no debe borrar las salidas ya construidas');
  }
});

Then('el script de build repite el comando de bundle', () => {
  const texto = readFileSync(join(raiz(), 'build.sh'), 'utf8');
  if (!texto.includes('iteraciones bundle -o')) {
    throw new Error(`build.sh no repite el comando:\n${texto}`);
  }
});

Then('la copia reconstruye el mismo markdown', () => {
  const original = readFileSync(join(salida(), 'ensayo.md'));
  const reconstruido = readFileSync(join(world.root, 'copia', 'dist', 'files', 'ensayo.md'));
  if (!reconstruido.equals(original)) {
    throw new Error('la copia del markdown no salió idéntica al original');
  }
});

Then('la copia también tiene su propia réplica', () => {
  if (!existsSync(join(world.root, 'copia', 'dist', 'files', 'iteraciones.config.yaml'))) {
    throw new Error('la copia no replicó nada: no se sostiene sola');
  }
});

Then('el .tex apunta al QR con una ruta relativa de assets', () => {
  if (!existsSync(join(salida(), 'ensayo.tex'))) {
    throw new Error(`no se generó el .tex${world.errorBuild ? `: ${world.errorBuild}` : ''}`);
  }
  const tex = readFileSync(join(salida(), 'ensayo.tex'), 'utf8');
  if (!/\{assets\/images\/qr-[0-9a-f]+\.jpg\}/.test(tex)) {
    throw new Error(`el .tex no apunta a assets/images:\n${tex.slice(0, 400)}`);
  }
});

Then('el .tex no lleva ninguna ruta absoluta', () => {
  const tex = readFileSync(join(salida(), 'ensayo.tex'), 'utf8');
  const absolutas = tex.match(/\{\/[^}]+\}/g) ?? [];
  if (absolutas.length > 0) {
    throw new Error(`el .tex lleva rutas absolutas, que no compila en otra máquina: ${JSON.stringify(absolutas)}`);
  }
});

// ── Las rutas, en crudo ────────────────────────────────────────────────────

/** `relativizeTexForDist` es puro: la raíz del proyecto y la del `.tex`. */
When('relativizo {string} para la salida {string}', (ruta: string, dirTex: string) => {
  world.raizProyecto = '/proy';
  world.texRelativizado = relativizeTexForDist(
    ruta,
    { 'la salida': '/proy/dist/files', 'un nivel más': '/proy/dist/files/test', 'la raíz del proyecto': '/proy' }[dirTex] ?? dirTex,
    world.raizProyecto,
  );
});

Then('queda {string}', (esperado: string) => {
  if (world.texRelativizado !== esperado) {
    throw new Error(`queda ${JSON.stringify(world.texRelativizado)} y debía quedar ${JSON.stringify(esperado)}`);
  }
});

/** `localizeDistAssets`: decide si la ruta se relativiza o además se copia. */
Given('un proyecto con la bibliografía', () => {
  escribirEnProyecto('bibliografia.bib', '@book{ruiz2026, title = {Cuidar}}\n');
});

Given('un proyecto con un preámbulo propio', () => {
  escribirEnProyecto('preamble/04-margins.tex', '% margenes\n');
});

When('localizo los assets con bundle {string}', async (estado: string) => {
  const bib = join(raiz(), 'bibliografia.bib');
  const margen = join(raiz(), 'preamble', '04-margins.tex');
  const fuente = estado === 'bibliografia' ? `\\addbibresource{${bib}}` : `\\input{${margen}}`;
  const r = await localizeDistAssets(fuente, {
    texDir: salida(),
    projectRoot: raiz(),
    distRoot: salida(),
    bundle: true,
  });
  world.texLocalizado = r.tex;
  world.copias = r.copies;
});

Then('el .tex usa {string}', (esperado: string) => {
  if (world.texLocalizado !== esperado) {
    throw new Error(`el .tex usa ${JSON.stringify(world.texLocalizado)} y debía usar ${JSON.stringify(esperado)}`);
  }
});

Then('no se copia nada', () => {
  const copias = world.copias as unknown[];
  if (copias.length > 0) throw new Error(`se copió ${JSON.stringify(copias)} y no debía copiarse nada`);
});
