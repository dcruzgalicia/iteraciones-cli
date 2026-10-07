import { Given, Then, When } from '@cucumber/cucumber';
import { extractFragment } from '../../builder/collection-fragment.js';
import { world } from './cli-world.steps.ts';

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

import { collectionBaseContent, collectionCardsContent, collectionScanContent, memberHtmlHrefs } from '../../builder/pipeline-formats.js';

function miembro(over: Partial<CollectionEntry> = {}): CollectionEntry {
  return {
    file: 'doc.md',
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
  return members.map((m) => miembro(m)) as CollectionEntry[];
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
