import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { runBuild } from '../../cli/dispatcher.js';

/**
 * #2546 (onda 2) — `dist-assets-images`: el contrato del directorio `assets`.
 *
 * ## Por qué seis pasos y no veintidós `expect`
 *
 * El original es un `it()` con 22 aserciones numeradas del 1 al 6. El issue
 * pregunta si dividirlo. La respuesta es dividir por COMPORTAMIENTO: seis pasos
 * que se leen como seis reglas —una copia por imagen, los formatos la
 * referencian, el nivel anidado no sube, el markdown cubre las tres formas del
 * frontmatter, el mapa de rutas existe, nada estático queda fuera— y cada uno
 * agrupa las aserciones que lo demuestran.
 *
 * ## La raíz canónica aparece en una clave del mapa
 *
 * La clave absoluta del mapa de #2460 usa la raíz canónica: en macOS `/var` es
 * un enlace a `/private/var`. Comparar contra el `dir` sin canonicalizar daría
 * un falso negativo sólo en macOS, que es donde corremos.
 */

const CONFIG = [
  'language: es-MX',
  'format:',
  '  html:',
  '    site:',
  '      title: T',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

/** #2441 — las tres formas del frontmatter: escalar, lista y multilínea. */
const DOC = [
  '---',
  'title: Ejemplo',
  'slug: ejemplo',
  'titleImage: portada.png',
  'publisherImage:',
  '  - editorial.png',
  'frontispiece: |',
  '  ![Frontis](frontis.png)',
  '---',
  '',
  '# Capítulo',
  '',
  '![foto](foto.png)',
  '',
  'Referencia: ![ref][r]',
  '',
  '[r]: referencia.png',
  '',
  '<img src="crudo.png" alt="crudo">',
  '',
].join('\n');

const ANEXO = ['---', 'title: Anexo', 'slug: anexo', '---', '', '# Anexo', '', '![gráfica](grafico.png)', ''].join('\n');

const IMAGENES = [
  ['foto.png', 'white'],
  ['portada.png', 'gray'],
  ['editorial.png', 'gray'],
  ['frontis.png', 'gray'],
  ['referencia.png', 'gray'],
  ['crudo.png', 'gray'],
] as const;

interface AssetsWorld {
  dir: string;
  dist: string;
}

const world: AssetsWorld = { dir: '', dist: '' };

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  world.dist = join(world.dir, 'dist', 'files');
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

async function magick(nombre: string, color: string, dir = world.dir): Promise<void> {
  const proc = Bun.spawnSync(['magick', '-size', '2x2', `xc:${color}`, join(dir, nombre)]);
  if (proc.exitCode !== 0) throw new Error(`magick no pudo crear ${nombre}`);
}

async function existe(ruta: string): Promise<boolean> {
  return Bun.file(ruta).exists();
}

Given('un proyecto con un manuscrito y un anexo anidado, cada uno con sus imágenes', async () => {
  await Bun.write(join(world.dir, 'iteraciones.config.yaml'), `${CONFIG}\n`);
  for (const [nombre, color] of IMAGENES) await magick(nombre, color);
  await Bun.write(join(world.dir, 'manuscrito.md'), `${DOC}\n`);
  // Documento anidado: su assets vive en su propio nivel.
  await mkdir(join(world.dir, 'sub'), { recursive: true });
  await Bun.write(join(world.dir, 'sub', 'anexo.md'), `${ANEXO}\n`);
  await magick('grafico.png', 'black', join(world.dir, 'sub'));
});

Given('el frontmatter del manuscrito trae las tres formas de imagen', () => {
  // El documento ya lo trae en el Given anterior: escalar (`titleImage`),
  // lista (`publisherImage`) y multilínea (`frontispiece: |`). Este step declara
  // la precondición para que el feature se lea sin conocer el literal.
});

When('compilo el proyecto por el CLI', async () => {
  process.exitCode = 0;
  await runBuild(world.dir);
});

Then('la copia de cada imagen vive en el directorio de imágenes de su nivel', async () => {
  const esperadas = [
    // Una copia por imagen, en el assets/images de su nivel, con el prefijo del
    // slug del documento que la procesó.
    [join('assets', 'images', 'ejemplo-foto.jpg'), true],
    [join('assets', 'img', 'foto.jpg'), false],
    ['foto.jpg', false],
    [join('sub', 'assets', 'images', 'anexo-grafico.jpg'), true],
  ] as const;
  for (const [ruta, debeExistir] of esperadas) {
    const hay = await existe(join(world.dist, ruta));
    if (hay !== debeExistir) {
      throw new Error(`${ruta} ${hay ? 'existe' : 'no existe'} y debía ${debeExistir ? 'existir' : 'no existir'}`);
    }
  }
});

Then('el formato exportado la referencia desde ese directorio', async () => {
  // HTML y markdown la referencian relativa a sus salidas.
  for (const nombre of ['ejemplo.html', 'ejemplo.md']) {
    const content = await readFile(join(world.dist, nombre), 'utf8');
    if (!content.includes('assets/images/ejemplo-foto.jpg')) {
      throw new Error(`${nombre} no referencia la imagen desde assets/images`);
    }
  }
});

Then('el anexo no sube con dos puntos para llegar a su directorio', async () => {
  // Su assets vive en SU nivel, y sus salidas la referencian igual que la raíz.
  for (const nombre of ['anexo.html', 'anexo.md']) {
    const content = await readFile(join(world.dist, 'sub', nombre), 'utf8');
    if (!content.includes('./assets/images/anexo-grafico.jpg')) {
      throw new Error(`sub/${nombre} no referencia su imagen desde ./assets/images`);
    }
    if (content.includes('../assets/images/anexo-grafico.jpg')) {
      throw new Error(`sub/${nombre} sube con ".." para llegar a su assets: la referencia debe ser relativa a su nivel`);
    }
  }
});

Then('el markdown exportado apunta a assets en todas las formas', async () => {
  const md = await readFile(join(world.dist, 'ejemplo.md'), 'utf8');
  for (const esperado of [
    'titleImage: ./assets/images/ejemplo-portada.jpg',
    '- ./assets/images/ejemplo-editorial.jpg',
    './assets/images/ejemplo-frontis.jpg',
    './assets/images/ejemplo-referencia.jpg',
    'src="./assets/images/ejemplo-crudo.jpg"',
  ]) {
    if (!md.includes(esperado)) throw new Error(`el markdown exportado no trae ${esperado}`);
  }
  // Ninguna forma puede dejar una ruta del proyecto fuente colgando.
  for (const prohibido of ['portada.png', 'editorial.png', 'frontis.png', 'referencia.png', 'crudo.png']) {
    if (md.includes(prohibido)) throw new Error(`el markdown exportado conserva la ruta del fuente: ${prohibido}`);
  }
});

Then('el mapa de rutas por documento y formato existe', async () => {
  const mapaPath = join(world.dir, '.iteraciones', 'paths', 'manuscrito.md.html.json');
  const mapa = JSON.parse(await readFile(mapaPath, 'utf8')) as Record<string, string>;
  const destino = './assets/images/ejemplo-foto.jpg';
  if (mapa['foto.png'] !== destino) throw new Error(`la clave relativa del mapa no apunta a ${destino}: ${String(mapa['foto.png'])}`);
  // La clave ABSOLUTA usa la raíz canónica: en macOS `/var` es un enlace a
  // `/private/var`, y comparar contra el `dir` sin canonicalizar daría un falso
  // negativo sólo en macOS.
  const canonico = await realpath(world.dir);
  const claveAbsoluta = `${canonico}/foto.png`;
  if (mapa[claveAbsoluta] !== destino) {
    throw new Error(`la clave absoluta ${claveAbsoluta} no apunta a ${destino}`);
  }
  if (!(await existe(join(world.dir, '.iteraciones', 'paths', 'sub', 'anexo.md.html.json')))) {
    throw new Error('falta el mapa de rutas del anexo anidado');
  }
});

Then('ningún archivo estático queda fuera de un directorio assets', async () => {
  const fuera: string[] = [];
  for await (const entry of new Bun.Glob('**/*').scan({ cwd: world.dist, onlyFiles: true })) {
    const estatico = /\.(jpe?g|png|svg|ttf|otf|woff2?)$/i.test(entry) || entry.endsWith('.css');
    if (estatico && !entry.split('/').includes('assets')) fuera.push(entry);
  }
  if (fuera.length > 0) {
    throw new Error(`archivos estáticos fuera de un directorio assets:\n  ${fuera.join('\n  ')}`);
  }
});
