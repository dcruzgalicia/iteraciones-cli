import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { runBuild } from '../../cli/dispatcher.js';

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

  await mkdir(join(world.dir, 'sub'), { recursive: true });
  await Bun.write(join(world.dir, 'sub', 'anexo.md'), `${ANEXO}\n`);
  await magick('grafico.png', 'black', join(world.dir, 'sub'));
});

Given('el frontmatter del manuscrito trae las tres formas de imagen', () => {});

When('compilo el proyecto por el CLI', async () => {
  process.exitCode = 0;
  await runBuild(world.dir);
});

Then('la copia de cada imagen vive en el directorio de imágenes de su nivel', async () => {
  const esperadas = [
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
  for (const nombre of ['ejemplo.html', 'ejemplo.md']) {
    const content = await readFile(join(world.dist, nombre), 'utf8');
    if (!content.includes('assets/images/ejemplo-foto.jpg')) {
      throw new Error(`${nombre} no referencia la imagen desde assets/images`);
    }
  }
});

Then('el anexo no sube con dos puntos para llegar a su directorio', async () => {
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

  for (const prohibido of ['portada.png', 'editorial.png', 'frontis.png', 'referencia.png', 'crudo.png']) {
    if (md.includes(prohibido)) throw new Error(`el markdown exportado conserva la ruta del fuente: ${prohibido}`);
  }
});

Then('el mapa de rutas por documento y formato existe', async () => {
  const mapaPath = join(world.dir, '.iteraciones', 'paths', 'manuscrito.md.html.json');
  const mapa = JSON.parse(await readFile(mapaPath, 'utf8')) as Record<string, string>;
  const destino = './assets/images/ejemplo-foto.jpg';
  if (mapa['foto.png'] !== destino) throw new Error(`la clave relativa del mapa no apunta a ${destino}: ${String(mapa['foto.png'])}`);

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
