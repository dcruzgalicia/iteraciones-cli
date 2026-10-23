import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { extractFragment } from '../../builder/collection-fragment.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

function palabras(cuantas: number): string {
  return Array.from({ length: cuantas }, (_, i) => `palabra${i + 1}`).join(' ');
}

Given('que el documento tiene el cuerpo:', (cuerpo: string) => {
  world.cuerpoDoc = cuerpo.replace(/<br>/g, '\n');
});

Given('que el cuerpo es un párrafo con {int} palabras', (cuantas: number) => {
  world.cuerpoDoc = `Un primer párrafo. ${palabras(cuantas)}`;
});

Given('que el cuerpo es un bloque de {int} palabras', (cuantas: number) => {
  world.cuerpoDoc = `::: {.nota}\n${palabras(cuantas)}\n:::`;
});

Given('que el cuerpo es {int} palabras y un enlace', (cuantas: number) => {
  world.cuerpoDoc = `${palabras(cuantas)} [texto del enlace](./destino.html)`;
});

When('extraigo su fragmento', () => {
  world.fragmento = extractFragment(world.cuerpoDoc);
});

Then('el fragmento es:', (esperado: string) => {
  if (world.fragmento !== esperado.replace(/<br>/g, '\n').replace(/\n$/, '')) {
    throw new Error(`el fragmento es ${JSON.stringify(world.fragmento)} y debería ser ${JSON.stringify(esperado)}`);
  }
});

Then('el fragmento es {string}', (esperado: string) => {
  const quiere = esperado.replace(/<br>/g, '\n');
  if (world.fragmento !== quiere) {
    throw new Error(`el fragmento es ${JSON.stringify(world.fragmento)} y debería ser ${JSON.stringify(quiere)}`);
  }
});

Then('el fragmento tiene {int} palabras en su línea de contenido', (cuantas: number) => {
  const lineas = world.fragmento.split('\n');
  const leidas = (lineas[1] ?? '').split(/\s+/).length;
  if (leidas !== cuantas) {
    throw new Error(`la línea de contenido tiene ${leidas} palabras y son ${cuantas}`);
  }
});

Then('el fragmento está vacío', () => {
  if (world.fragmento !== '') {
    throw new Error(`esperaba un fragmento vacío y salió ${JSON.stringify(world.fragmento)}`);
  }
});

Then('el fragmento se corta con puntos suspensivos', () => {
  if (!world.fragmento.endsWith('...')) {
    throw new Error(`el fragmento no termina en puntos: ${JSON.stringify(world.fragmento.slice(-40))}`);
  }
});

Then('el fragmento tiene {int} palabras', (cuantas: number) => {
  const leidas = world.fragmento.split(/\s+/).length;
  if (leidas !== cuantas) {
    throw new Error(`el fragmento tiene ${leidas} palabras y son ${cuantas}`);
  }
});

Then('el título de la tarjeta del miembro es un enlace', () => {
  const titulo = world.html.match(/<h3 class="[^"]*">(.*?)<\/h3>/s);
  if (titulo === null) throw new Error('la tarjeta del miembro no tiene título');
  if (!titulo[1]?.includes('<a href="')) {
    throw new Error(`el título del miembro no es un enlace: ${titulo[1]}`);
  }
});

Then('el fragmento no dice {string}', (texto: string) => {
  if (world.fragmento.includes(texto)) {
    throw new Error(`el fragmento sí dice ${JSON.stringify(texto)} y no debería`);
  }
});

Then('el fragmento cierra el bloque él mismo', () => {
  const lineas = world.fragmento.split('\n');
  if (lineas[0] !== '::: {.nota}') throw new Error(`el bloque no abre con su clase: ${JSON.stringify(lineas[0])}`);
  if (lineas[lineas.length - 1] !== ':::') {
    throw new Error(`el bloque no cierra: termina en ${JSON.stringify(lineas[lineas.length - 1])}`);
  }
});

Then('los puntos suspensivos van antes del cierre del bloque', () => {
  const lineas = world.fragmento.split('\n');
  if (lineas[lineas.length - 2] !== '...') {
    throw new Error(`los puntos no van antes del cierre: penúltima línea ${JSON.stringify(lineas[lineas.length - 2])}`);
  }
});

import type { CollectionEntry } from '../../builder/pipeline-formats.js';

import {
  collectionBaseContent,
  collectionCardsContent,
  collectionCardsPages,
  collectionScanContent,
  memberHtmlHrefs,
  paginationNav,
} from '../../builder/pipeline-formats.js';

function miembro(over: Partial<CollectionEntry> = {}): CollectionEntry {
  return {
    file: 'doc.md',
    posicion: 1,
    title: 'Documento',
    creator: ['Autora A'],
    subtitle: undefined,
    type: 'file',
    lineLength: undefined,
    pages: undefined,
    body: 'Contenido de doc.',
    ...over,
  };
}

function coleccion(members: Miembro[]): CollectionEntry[] {
  return members.map((m, indice) => miembro({ ...m, posicion: indice + 1 })) as CollectionEntry[];
}

type Miembro = { file: string; title: string; creator: string[]; body: string };

function indiceDeSlugs(): Map<string, { title: string; creator: string[]; slug?: string }> {
  return new Map([
    ['doc.md', { title: 'Documento', creator: [], slug: 'documento-por-autora-a' }],
    ['anexos/doc.md', { title: 'Documento', creator: [], slug: 'documento-por-autora-a' }],
    ['sin-slug.md', { title: 'Otro', creator: [] }],
  ]);
}

Given('que la colección tiene {int} miembros', (cuantos: number) => {
  world.miembros = Array.from({ length: cuantos }, () => miembro());
});

Given('que la colección tiene el cuerpo propio:', (cuerpo: string) => {
  world.cuerpoColeccion = cuerpo.replace(/<br>/g, '\n');
});

Given('que un miembro está en {string}', (ruta: string) => {
  world.miembros = [miembro({ file: ruta })];
  world.rutaColeccion = ruta.replace('doc.md', 'coleccion.md');
});

Given('que la colección está en {string}', (ruta: string) => {
  world.rutaColeccion = ruta;
});

Given('que la colección tiene un cuerpo propio con {int} palabras', (cuantas: number) => {
  world.miembros = [miembro({ body: `${palabras(cuantas)}.\n\nSegundo párrafo que no debe aparecer.` })];
});

Given('que la colección tiene un cuerpo propio con {int} palabras y un segundo párrafo', (cuantas: number) => {
  world.miembros = [miembro({ body: `${palabras(cuantas)}.\n\nSegundo párrafo que sí debe aparecer.` })];
});

When('compogo las tarjetas de la página HTML', () => {
  world.html = collectionCardsContent(
    coleccion(world.miembros),
    memberHtmlHrefs(world.rutaColeccion, coleccion(world.miembros), indiceDeSlugs()),
    world.cuerpoColeccion,
  );
});

When('compongo el HTML base para el EPUB', () => {
  world.html = collectionBaseContent(coleccion(world.miembros), 'html', world.cuerpoColeccion);
});

When('compogo las páginas de la colección con {int} por página', (pageSize: number) => {
  const entradas = coleccion(world.miembros);
  const hrefs = memberHtmlHrefs(world.rutaColeccion, entradas, indiceDeSlugs());
  world.paginas = collectionCardsPages(entradas, hrefs, world.cuerpoColeccion, pageSize);
  world.navs = world.paginas.map((_, indice) => paginationNav(world.rutaColeccion, 'antologia', indice + 1, world.paginas.length));
});

When('escaneo las imágenes de la collection', () => {
  world.html = collectionScanContent(coleccion(world.miembros), world.cuerpoColeccion);
});

When('calculo los enlaces al HTML de cada miembro', () => {
  world.enlaces = memberHtmlHrefs(world.rutaColeccion, coleccion(world.miembros), indiceDeSlugs());
});

Then('el HTML dice {string}', (texto: string) => {
  if (!world.html.includes(texto)) throw new Error(`el HTML no dice ${JSON.stringify(texto)}`);
});

Then('el HTML no dice {string}', (texto: string) => {
  if (world.html.includes(texto)) throw new Error(`el HTML sí dice ${JSON.stringify(texto)} y no debería`);
});

Then('el HTML pone {string} antes que {string}', (primero: string, segundo: string) => {
  const a = world.html.indexOf(primero);
  const b = world.html.indexOf(segundo);
  if (a < 0) throw new Error(`el HTML no tiene ${JSON.stringify(primero)}`);
  if (a >= b) throw new Error(`${JSON.stringify(primero)} (${a}) no va antes que ${JSON.stringify(segundo)} (${b})`);
});

Then('el HTML tiene {int} contenedores de masonry', (cuantos: number) => {
  const leidos = (world.html.match(/break-inside-avoid pb-6/g) ?? []).length;
  if (leidos !== cuantos) throw new Error(`hay ${leidos} contenedores y son ${cuantos}`);
});

Then('los badges de las tarjetas son {string}', (esperados: string) => {
  const leidos = [...world.html.matchAll(/<span class="[^"]*">(\d+)<\/span>/g)].map((m) => m[1]).join(', ');
  if (leidos !== esperados) {
    throw new Error(`los badges son ${JSON.stringify(leidos)} y deberían ser ${JSON.stringify(esperados)}`);
  }
});

Then('el chip y el badge van en la misma fila', () => {
  const fila = world.html.match(/<div class="flex items-start justify-between gap-4">.*?<\/div>/s);
  if (fila === null) throw new Error('el chip y el badge no van en una fila con el chip a la izquierda y el badge a la derecha');
  if (!fila[0].includes('<h2')) throw new Error('la fila no tiene el chip');
  if (!fila[0].includes('<span')) throw new Error('la fila no tiene el badge');
});

Then('el HTML no tiene triple salto de línea', () => {
  if (world.html.includes('\n\n\n')) {
    throw new Error('el HTML tiene un triple salto de línea, que el markdown no puede volver a parsear');
  }
});

Then('el enlace del miembro es {string}', (esperado: string) => {
  const leido = world.enlaces.get(world.miembros[0]?.file ?? '');
  if (leido !== esperado) throw new Error(`el enlace es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(esperado)}`);
});

Then('el miembro no tiene enlace', () => {
  if (world.enlaces.has(world.miembros[0]?.file ?? '')) {
    throw new Error('el miembro tiene enlace y no debería: sin slug no hay HTML al que apuntar');
  }
});

Then('el HTML es {string}', (esperado: string) => {
  if (world.html !== esperado) {
    throw new Error(`el HTML es ${JSON.stringify(world.html)} y debería ser ${JSON.stringify(esperado)}`);
  }
});

Then('hay {int} páginas', (cuantas: number) => {
  const paginas = world.paginas as string[];
  if (paginas.length !== cuantas) {
    throw new Error(`hay ${paginas.length} páginas y son ${cuantas}`);
  }
});

Then('la página {int} tiene {int} tarjetas', (pagina: number, cuantas: number) => {
  const html = (world.paginas as string[])[pagina - 1] ?? '';
  const leidas = (html.match(/tarjeta-fragmento/g) ?? []).length;
  if (leidas !== cuantas) {
    throw new Error(`la página ${pagina} tiene ${leidas} tarjetas y son ${cuantas}`);
  }
});

Then('la página {int} dice {string}', (pagina: number, texto: string) => {
  const html = (world.paginas as string[])[pagina - 1] ?? '';
  if (!html.includes(texto)) {
    throw new Error(`la página ${pagina} no dice ${JSON.stringify(texto)}`);
  }
});

Then('la página {int} no dice {string}', (pagina: number, texto: string) => {
  const html = (world.paginas as string[])[pagina - 1] ?? '';
  if (html.includes(texto)) {
    throw new Error(`la página ${pagina} sí dice ${JSON.stringify(texto)} y no debería`);
  }
});

Then('el nav de la página {int} dice {string}', (pagina: number, texto: string) => {
  const nav = (world.navs as string[])[pagina - 1] ?? '';
  if (!nav.includes(texto)) {
    throw new Error(`el nav de la página ${pagina} no dice ${JSON.stringify(texto)}: ${nav}`);
  }
});

Then('el nav de la página {int} no enlaza a {string}', (pagina: number, texto: string) => {
  const nav = (world.navs as string[])[pagina - 1] ?? '';
  if (nav.includes(texto)) {
    throw new Error(`el nav de la página ${pagina} sí enlaza a ${JSON.stringify(texto)} y no debería`);
  }
});

Then('el nav de la página {int} enlaza a {string}', (pagina: number, texto: string) => {
  const nav = (world.navs as string[])[pagina - 1] ?? '';
  if (!nav.includes(texto)) {
    throw new Error(`el nav de la página ${pagina} no enlaza a ${JSON.stringify(texto)}: ${nav}`);
  }
});

Then('el nav de la página {int} está vacío', (pagina: number) => {
  const nav = (world.navs as string[])[pagina - 1] ?? '';
  if (nav !== '') {
    throw new Error(`el nav de la página ${pagina} no está vacío: ${nav}`);
  }
});

Given('una colección con {int} miembros', (cuantos: number) => {
  const files: string[] = [];
  for (let i = 1; i <= cuantos; i++) {
    escribirEnProyecto(`doc-${i}.md`, `---\ntitle: Documento ${i}\n---\n\nContenido ${i}.\n`);
    files.push(`  - ./doc-${i}.md`);
  }
  escribirEnProyecto('antologia.md', `---\ntitle: Antología\ntype: collection\nfiles:\n${files.join('\n')}\n---\n`);
});

Given('el proyecto pagina de {int} tarjetas', (porPagina: number) => {
  escribirEnProyecto(
    'iteraciones.config.yaml',
    `language: es-MX\nformat:\n  html:\n    site:\n      title: Test\n    generate: true\n    pageSize: ${porPagina}\n`,
  );
});

Then('el archivo {string} dice {string}', async (relativa: string, texto: string) => {
  const contenido = await Bun.file(join(world.root, relativa)).text();
  if (!contenido.includes(texto)) {
    throw new Error(`${relativa} no dice ${JSON.stringify(texto)}`);
  }
});

Then('el archivo {string} no dice {string}', async (relativa: string, texto: string) => {
  const contenido = await Bun.file(join(world.root, relativa)).text();
  if (contenido.includes(texto)) {
    throw new Error(`${relativa} sí dice ${JSON.stringify(texto)} y no debería`);
  }
});

Then('el nav de la página {int} es flotante', (_pagina: number) => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'antologia-2.html'), 'utf8');
  const nav = html.match(/<nav class="([^"]*)"/);
  if (nav === null) throw new Error('la página no tiene nav');
  if (!nav[1]?.includes('fixed') || !nav[1]?.includes('bottom-6')) {
    throw new Error(`el nav no flota al pie: ${nav[1]}`);
  }
});

Then('el título de la página {int} no lleva el número de página', (pagina: number) => {
  const html = readFileSync(join(world.root, 'dist', 'files', `antologia-${pagina}.html`), 'utf8');
  const titulo = html.match(/<h1[^>]*>([^<]*)<\/h1>/);
  if (titulo === null) throw new Error('la página no tiene título');
  const pestaña = html.match(/<title>([^<]*)<\/title>/);
  if (pestaña === null) throw new Error('la página no tiene título de pestaña');
  for (const texto of [titulo[1] ?? '', pestaña[1] ?? '']) {
    if (/\(\d+\/\d+\)/.test(texto)) {
      throw new Error(`el título lleva el número de página: ${texto}`);
    }
  }
});

Then('el nav de la página {int} se revela al final de la página', (_pagina: number) => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'antologia-2.html'), 'utf8');
  if (!html.includes('scroll-reveal-at-end')) {
    throw new Error('los botones del nav no se esconden hasta el final');
  }
  const css = readFileSync(join(world.root, 'dist', 'files', 'assets', 'css', 'styles.css'), 'utf8');
  if (!/animation-range:\s*90%\s*100%/.test(css)) {
    throw new Error('el CSS no revela los botones al final del scroll');
  }
});

Then('el nav de la página {int} no está dentro del texto', (_pagina: number) => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'antologia-2.html'), 'utf8');
  const nav = html.indexOf('<nav class=');
  const article = html.indexOf('<article');
  const fin = html.indexOf('</article>');
  if (article >= 0 && fin >= 0 && article < nav && nav < fin) {
    throw new Error('el nav sigue dentro del artículo del texto');
  }
});

Then('el nombre de la creadora de la tarjeta no usa el color del accent', () => {
  const html = world.html as string;
  const linea = html.match(/<h2 class="text-center text-base">([\s\S]*?)<\/h2>/);
  if (linea === null) throw new Error('la tarjeta no tiene la línea de la creadora');
  if (linea[1]?.includes('text-accent') === true) {
    throw new Error(`la creadora usa el color del accent: ${linea[1]}`);
  }
});

Then('el nav de la página {int} no dice {string}', (pagina: number, texto: string) => {
  const nav = (world.navs as string[])[pagina - 1] ?? '';
  if (nav.includes(texto)) {
    throw new Error(`el nav de la página ${pagina} sí dice ${JSON.stringify(texto)}: ${nav}`);
  }
});
