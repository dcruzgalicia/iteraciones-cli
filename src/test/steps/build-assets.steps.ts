import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { buildAssets } from '../../builder/build-assets.js';
import { cleanupDeletedFiles, cleanupRemovedFormats, cleanupSlugChanges, hasLegacyAssetLayout } from '../../builder/cleanup.js';
import type { BuildContext, DiscoveryEntry } from '../../builder/types.js';
import { runBuild } from '../../cli/dispatcher.js';
import { DEFAULT_SITE_CONFIG } from '../../config/site-config.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

const salida = (): string => join(world.root, 'dist', 'files');

function ctx(): BuildContext {
  return {
    cwd: world.root,
    siteConfig: DEFAULT_SITE_CONFIG,
    outputDir: salida(),
    concurrency: 2,
    needsCss: false,
  };
}

function entradaBorrada(ruta: string, slug: string): [string, DiscoveryEntry] {
  return [ruta, { title: 'T', creator: [], date: '', mtime: 0, size: 0, hash: '', slug }];
}

Given('una salida para los assets', () => {
  mkdirSyncWorld(salida());
});

function mkdirSyncWorld(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

When('construyo los assets', async () => {
  await buildAssets(salida(), world.root, DEFAULT_SITE_CONFIG);
});

When('construyo los assets otra vez', async () => {
  await buildAssets(salida(), world.root, DEFAULT_SITE_CONFIG);
});

Given('un proyecto con un logo propio', () => {
  escribirEnProyecto('assets/mi-logo.svg', '<svg>A</svg>');
});

When('el proyecto cambia su logo a {string}', (contenido: string) => {
  escribirEnProyecto('assets/mi-logo.svg', contenido);
});

When('construyo los assets con el logo del proyecto', async () => {
  const config = {
    ...DEFAULT_SITE_CONFIG,
    format: {
      ...DEFAULT_SITE_CONFIG.format,
      html: {
        ...DEFAULT_SITE_CONFIG.format.html,
        site: { ...DEFAULT_SITE_CONFIG.format.html?.site, logo: 'assets/mi-logo.svg' },
      },
    },
  };
  await buildAssets(salida(), world.root, config);
});

function readCss(): string {
  return readFileSync(join(salida(), 'assets', 'css', 'styles.css'), 'utf8');
}

Then('el logo copiado dice {string}', (esperado: string) => {
  const svg = readFileSync(join(salida(), 'assets', 'images', 'favicon.svg'), 'utf8');
  if (svg !== esperado) throw new Error(`el logo copiado dice ${JSON.stringify(svg)} y debía decir ${esperado}`);
});

Then('el logo copiado no se ha vuelto a escribir', () => {
  const antes = world.mtimeLogo as number;
  const ahora = statSync(join(salida(), 'assets', 'images', 'favicon.svg')).mtimeMs;
  if (ahora !== antes) {
    throw new Error(`el logo se reescribió (mtime ${antes} → ${ahora}): eso invalida el CSS sin motivo`);
  }
});

Then('anoto la fecha del logo copiado', () => {
  world.mtimeLogo = statSync(join(salida(), 'assets', 'images', 'favicon.svg')).mtimeMs;
});

Given('un documento borrado con slug {string} y estos artefactos:', (slug: string, artefactos: string) => {
  world.slugBorrado = slug;
  world.borrados = new Set([`${slug}.md`]);
  for (const linea of artefactos.split('\n')) {
    const limpia = linea.trim();
    if (limpia) escribirEnProyecto(limpia, 'x');
  }
});

When('limpio los documentos borrados', async () => {
  await cleanupDeletedFiles(
    ctx(),
    world.borrados as Set<string>,
    [],
    new Map([entradaBorrada(`${world.slugBorrado}.md`, world.slugBorrado as string)]),
  );
});

Given('un documento que antes se llamaba {string}', (slug: string) => {
  world.cambioSlug = slug;
  escribirEnProyecto(join('dist', 'files', `${slug}.html`), 'html');
});

When('limpio el slug que cambió', async () => {
  await cleanupSlugChanges(ctx(), new Map([['doc.md', world.cambioSlug as string]]));
});

Given('una salida con salidas de {string}', (formatos: string) => {
  world.formatosQuitados = formatos
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
});

Given('una salida con assets del layout nuevo y del anterior', () => {
  for (const relativa of [
    'dist/files/doc.html',
    'dist/files/doc.pdf',
    'dist/files/doc.tex',
    'dist/files/assets/css/styles.css',
    'dist/files/assets/fonts/x.ttf',
    'dist/files/assets/logo.svg',
    'dist/files/css/styles.css',
    'dist/files/fonts/x.ttf',
    'dist/files/logo.svg',
  ]) {
    escribirEnProyecto(relativa, 'x');
  }
});

When('limpio los formatos que ya no se piden', async () => {
  await cleanupRemovedFormats(ctx(), [{ relativePath: 'doc.md', slug: 'doc' } as never], world.formatosQuitados as string[]);
});

Given('una salida con el layout de assets anterior', () => {
  escribirEnProyecto('dist/files/css/styles.css', 'x');
  escribirEnProyecto('dist/files/fonts/x.ttf', 'x');
  escribirEnProyecto('dist/files/logo.svg', 'x');
});

Given('una salida con el layout nuevo', () => {
  escribirEnProyecto('dist/files/assets/css/styles.css', 'x');
  escribirEnProyecto('dist/files/assets/logo.svg', 'x');
});

Then('la salida se detecta como del layout anterior', async () => {
  if (!(await hasLegacyAssetLayout(salida()))) {
    throw new Error('una salida con css/ y fonts/ en la raíz es del layout anterior');
  }
});

Then('la salida NO se detecta como del layout anterior', async () => {
  if (await hasLegacyAssetLayout(salida())) {
    throw new Error('una salida con sólo assets/ no es del layout anterior');
  }
});

Given('un documento borrado sin slug conocido y estos artefactos:', (artefactos: string) => {
  world.slugBorrado = 'index';
  world.borrados = new Set(['index.md']);
  for (const linea of artefactos.split('\n')) {
    const limpia = linea.trim();
    if (limpia) escribirEnProyecto(limpia, 'x');
  }
});

Then('estos archivos ya no están:', (lista: string) => {
  const sobran = lista
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => existsSync(join(world.root, r)));
  if (sobran.length > 0) throw new Error(`siguen ahí: ${JSON.stringify(sobran)}`);
});

Then('estos archivos siguen aquí:', (lista: string) => {
  const faltan = lista
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => !existsSync(join(world.root, r)));
  if (faltan.length > 0) throw new Error(`ya no están: ${JSON.stringify(faltan)}`);
});

Then('en los assets hay:', (lista: string) => {
  const faltan = lista
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => !existsSync(join(salida(), r)));
  if (faltan.length > 0) throw new Error(`faltan en la salida: ${JSON.stringify(faltan)}`);
});

Then('en los assets NO hay:', (lista: string) => {
  const sobran = lista
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => existsSync(join(salida(), r)));
  if (sobran.length > 0) throw new Error(`están en la salida y no debían: ${JSON.stringify(sobran)}`);
});

Then('el CSS no menciona:', (lista: string) => {
  const css = readCss();
  const hay = lista
    .split('\n')
    .map((t) => t.trim().replace(/["']/g, ''))
    .filter(Boolean)
    .filter((t) => css.includes(t));
  if (hay.length > 0) throw new Error(`el CSS sí dice ${JSON.stringify(hay)}`);
});

Then('el CSS sí dice:', (lista: string) => {
  const css = readCss();
  const faltan = lista
    .split('\n')
    .map((t) => t.trim().replace(/["']/g, ''))
    .filter(Boolean)
    .filter((t) => !css.includes(t));
  if (faltan.length > 0) throw new Error(`el CSS no dice ${JSON.stringify(faltan)}`);
});

const CONFIG_LOGO = ['language: es-MX', 'format:', '  html:', '    generate: true', '    site:', '      title: T', '      color: pink'];

function crearLogo(nombre: string, color: string): void {
  const proc = Bun.spawnSync(['magick', '-size', '120x120', 'xc:none', '-fill', color, '-draw', 'circle 60,60 60,10', join(world.root, nombre)]);
  if (proc.exitCode !== 0) throw new Error(`magick no pudo crear ${nombre}`);
}

Given('un proyecto con un logo a color y un documento', () => {
  // Un degradado tiene muchos colores: no se tiñe, conserva los suyos.
  const proc = Bun.spawnSync(['magick', '-size', '120x120', 'gradient:red-blue', join(world.root, 'logo.png')]);
  if (proc.exitCode !== 0) throw new Error('magick no pudo crear el logo');
  escribirEnProyecto('iteraciones.config.yaml', [...CONFIG_LOGO, '      logo: ./logo.png'].join('\n'));
  escribirEnProyecto('doc.md', '---\ntitle: Doc\n---\n\nHola.\n');
});

Given('un proyecto con un logo de un color y un documento', () => {
  crearLogo('logo.png', 'black');
  escribirEnProyecto('iteraciones.config.yaml', [...CONFIG_LOGO, '      logo: ./logo.png'].join('\n'));
  escribirEnProyecto('doc.md', '---\ntitle: Doc\n---\n\nHola.\n');
});

When('compilo el sitio con su logo', async () => {
  await runBuild(world.root);
});

Then('el build deja el archivo {string}', async (relativa: string) => {
  if (!(await Bun.file(join(salida(), relativa)).exists())) throw new Error(`el build no dejó ${relativa}`);
});

Then('el HTML del documento referencia {string}', (aguja: string) => {
  const html = readFileSync(join(salida(), 'doc.html'), 'utf8');
  if (!html.includes(aguja)) throw new Error(`el HTML del documento no dice ${JSON.stringify(aguja)}`);
});

Then('el HTML del documento no incrusta imágenes en base64', () => {
  const html = readFileSync(join(salida(), 'doc.html'), 'utf8');
  if (html.includes('data:image')) throw new Error('el HTML del documento todavía incrusta imágenes en base64');
});

Then('el logo webp está teñido con el accent', () => {
  const proc = Bun.spawnSync([
    'magick',
    join(salida(), 'assets', 'images', 'logo.webp'),
    '-alpha',
    'off',
    '-colorspace',
    'HSL',
    '-channel',
    'G',
    '-separate',
    '+channel',
    '-format',
    '%[fx:mean]',
    'info:',
  ]);
  const saturacion = Number(proc.stdout.toString().trim());
  if (!(saturacion > 0.05)) throw new Error(`el logo quedó en gris (saturación media ${saturacion}): no se tiñó con el accent`);
});
