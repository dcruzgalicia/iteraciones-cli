import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { runBuild } from '../../cli/dispatcher.js';
import { initTestProject } from '../helpers.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — los árboles dorados de `dist` (#2012).
 *
 * ## El bug que estos tests cazan
 *
 * `index.md` se titula "Portada", pero su salida es `index.html`, no
 * `portada.html`. La limpieza usaba el slug del título en vez del slug de salida,
 * así que desactivar un formato dejaba los `index.*` huérfanos: archivos que nadie
 * había pedido, que no enlaza nada y que nadie borra.
 *
 * ## "Cero huérfanos" es la aserción real
 *
 * No basta con comprobar que los archivos esperados están. Hay que comprobar que
 * **todo** lo que hay en el árbol pertenece a un documento permitido, a los
 * assets globales o a un `.svg`. Un archivo que nadie reconoce es un bug aunque
 * nadie haya comprobado que debería estar.
 *
 * ## Un directorio vacío también es residuo
 *
 * Borrar `posts/borrable.md` deja `posts/` vacío. `readdir` recursivo no lo ve,
 * así que el escenario mira si queda alguna ruta bajo `posts/` en vez de mirar
 * si el directorio existe.
 */

const CONFIG_TODO = [
  'language: es-MX',
  'format:',
  '  latex:',
  '    generate: true',
  '  html:',
  '    site:',
  '      title: T',
  '    generate: true',
  '  pdf:',
  '    generate: true',
  '  epub:',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

const CONFIG_SOLO_HTML = ['language: es-MX', 'format:', '  html:', '    site:', '      title: T', '    generate: true'].join('\n');

/** El árbol completo de `dist/files`, con rutas relativas y `/`. */
function arbol(): string[] {
  const archivos: string[] = [];
  const recorrer = (rel: string): void => {
    for (const entrada of readdirSync(join(world.root, 'dist', 'files', rel), { withFileTypes: true })) {
      const ruta = rel === '' ? entrada.name : `${rel}/${entrada.name}`;
      if (entrada.isDirectory()) recorrer(ruta);
      else archivos.push(ruta);
    }
  };
  try {
    recorrer('');
  } catch {
    return [];
  }
  return archivos.sort();
}

// ── Escenario ──────────────────────────────────────────────────────────────

Given('un proyecto inicializado con todos los formatos', async () => {
  initTestProject(world.root);
  escribirEnProyecto('iteraciones.config.yaml', CONFIG_TODO);
  escribirEnProyecto('index.md', '---\ntitle: Portada\n---\n\nInicio.\n');
});

Given('un proyecto inicializado con un slug manual', async () => {
  initTestProject(world.root);
  escribirEnProyecto('test.md', '---\ntitle: Test Document\nslug: mi-url-vieja\n---\n\nContenido.\n');
});

Given('el proyecto se queda sólo con HTML', () => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG_SOLO_HTML);
});

Given('un proyecto inicializado con un documento en el directorio posts', async () => {
  initTestProject(world.root);
  mkdirSync(join(world.root, 'posts'), { recursive: true });
  escribirEnProyecto('posts/borrable.md', '---\ntitle: Borrable\n---\n\nTexto.\n');
});

Given('un proyecto inicializado con una colección', async () => {
  initTestProject(world.root);
  mkdirSync(join(world.root, 'contenido'), { recursive: true });
  escribirEnProyecto('contenido/portada.md', '---\ntitle: Mi Collection\ntype: collection\nfiles:\n  - contenido/cap1.md\n---\n\n');
  escribirEnProyecto('contenido/cap1.md', '---\ntitle: Capítulo 1\n---\n\nContenido.\n');
});

When('construyo para ver el árbol de la salida', async () => {
  process.exitCode = 0;
  await runBuild(world.root);
  world.arbolDist = arbol();
});

When('cambio el slug manual a {string}', (slug: string) => {
  escribirEnProyecto('test.md', `---\ntitle: Test Document\nslug: ${slug}\n---\n\nContenido.\n`);
});

When('borro el documento de posts', () => {
  rmSync(join(world.root, 'posts', 'borrable.md'));
});

Then('la salida contiene:', (lista: string) => {
  const hay = world.arbolDist as string[];
  const faltan = lista
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => !hay.includes(r));
  if (faltan.length > 0) throw new Error(`faltan ${JSON.stringify(faltan)} en la salida`);
});

Then('la salida ya NO contiene:', (lista: string) => {
  const hay = world.arbolDist as string[];
  const sobran = lista
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => hay.includes(r));
  if (sobran.length > 0) throw new Error(`siguen ahí ${JSON.stringify(sobran)}`);
});

Then('la salida no deja rutas bajo el prefijo {string}', (prefijo: string) => {
  const debajo = (world.arbolDist as string[]).filter((r) => r.startsWith(`${prefijo}/`));
  if (debajo.length > 0) throw new Error(`quedaron rutas bajo ${prefijo}/: ${JSON.stringify(debajo)}`);
});

/**
 * Cero huérfanos: toda ruta del árbol pertenece a un documento permitido, a los
 * assets globales o a un `.svg`. Un archivo que nadie reconoce es un bug aunque
 * nadie haya comprobado que debería estar.
 */
Then('la salida sólo contiene lo permitido:', (permitidos: string) => {
  const docs = permitidos
    .split('\n')
    .map((d) => d.trim())
    .filter(Boolean);
  const html = docs.map((d) => `${d}.html`);
  const sinDueño = (world.arbolDist as string[]).filter(
    (r) => !html.includes(r) && !r.startsWith('assets/') && r !== 'index.html' && !r.endsWith('.svg'),
  );
  if (sinDueño.length > 0) {
    throw new Error(`hay archivos que no pertenecen a ningún documento: ${JSON.stringify(sinDueño)}`);
  }
  for (const doc of html) {
    if (!(world.arbolDist as string[]).includes(doc)) {
      throw new Error(`falta ${doc} y el escenario lo esperaba`);
    }
  }
});
