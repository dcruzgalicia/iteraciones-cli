import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { buildAssets } from '../../builder/build-assets.js';
import { cleanupDeletedFiles, cleanupRemovedFormats, cleanupSlugChanges, hasLegacyAssetLayout } from '../../builder/cleanup.js';
import type { BuildContext, DiscoveryEntry } from '../../builder/types.js';
import { DEFAULT_SITE_CONFIG } from '../../config/site-config.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — los assets de la salida y su limpieza.
 *
 * ## El sitio usa las fuentes del navegador (#2487)
 *
 * Ni Exo 2 ni Space Mono: el CSS usa la sans y la mono del sistema. Copiar
 * fuentes al `dist` son cientos de kilobytes por build para una tipografía que
 * el lector ya tiene.
 *
 * ## Reescribir el logo sin necesidad rompe la caché
 *
 * Una segunda llamada a `buildAssets` no toca `logo.svg` si no cambió. Si lo
 * reescribiera, su mtime cambiaría, el hash del CSS y de los assets también, y
 * el siguiente build invalidaría el CSS sin motivo — que es exactamente el
 * bucle que este archivo evita.
 *
 * ## Las tres limpiezas, y qué borra cada una
 *
 * - **documento borrado**: sus salidas y su área de trabajo del PDF;
 * - **slug cambiado**: los artefactos del slug anterior;
 * - **formato que ya no se pide**: las salidas de ese formato y los assets de
 *   HTML, tanto del layout nuevo como del anterior (#2450).
 */

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

/** La entrada del índice de un documento que ya no está. */
function entradaBorrada(ruta: string, slug: string): [string, DiscoveryEntry] {
  return [ruta, { title: 'T', creator: [], date: '', mtime: 0, size: 0, hash: '', slug }];
}

// ── Los assets ─────────────────────────────────────────────────────────────

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
  const svg = readFileSync(join(salida(), 'assets', 'logo.svg'), 'utf8');
  if (svg !== esperado) throw new Error(`el logo copiado dice ${JSON.stringify(svg)} y debía decir ${esperado}`);
});

Then('el logo copiado no se ha vuelto a escribir', () => {
  const antes = world.mtimeLogo as number;
  const ahora = statSync(join(salida(), 'assets', 'logo.svg')).mtimeMs;
  if (ahora !== antes) {
    throw new Error(`el logo se reescribió (mtime ${antes} → ${ahora}): eso invalida el CSS sin motivo`);
  }
});

Then('anoto la fecha del logo copiado', () => {
  world.mtimeLogo = statSync(join(salida(), 'assets', 'logo.svg')).mtimeMs;
});

// ── La limpieza ────────────────────────────────────────────────────────────

/** Los artefactos de un documento que ya no existe. */
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

/** El slug anterior de un documento. */
Given('un documento que antes se llamaba {string}', (slug: string) => {
  world.cambioSlug = slug;
  escribirEnProyecto(join('dist', 'files', `${slug}.html`), 'html');
});

When('limpio el slug que cambió', async () => {
  await cleanupSlugChanges(ctx(), new Map([['doc.md', world.cambioSlug as string]]));
});

/** Los formatos que el proyecto ya no pide. */
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

// ── El layout viejo (#2450) ────────────────────────────────────────────────

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

/**
 * Un documento borrado cuyo slug nunca estuvo en el estado: `index.md` sin
 * entrada previa. El slug cae al basename, que es justo lo que hay que
 * comprobar — si la limpieza mirara el slug del índice en vez del nombre del
 * archivo, no borraría nada.
 */
Given('un documento borrado sin slug conocido y estos artefactos:', (artefactos: string) => {
  world.rutaBorrada = 'index.md';
  world.slugBorrado = 'index';
  world.borrados = new Set(['index.md']);
  for (const linea of artefactos.split('\n')) {
    const limpia = linea.trim();
    if (limpia) escribirEnProyecto(limpia, 'x');
  }
});

/**
 * Un assert por step es lo que el catálogo rechaza: una lista de rutas y una
 * lista de "éstas NO" comprueban lo mismo en un solo paso.
 */
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
