import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { nombresEnlazados } from '../../builder/pipeline-formats.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

Given('una creadora llamada {string}', (nombre: string) => {
  escribirEnProyecto('ana-garcia.md', `---\ntype: creator\nname: ${nombre}\n---\n\nBio de ${nombre}.\n`);
});

Given('un texto de {string}', (nombre: string) => {
  escribirEnProyecto('texto.md', `---\ntitle: Un texto\ncreator: ${nombre}\n---\n\nCuerpo del texto.\n`);
});

Given('una colección de {string}', (nombre: string) => {
  escribirEnProyecto('antologia.md', `---\ntitle: Antología\ntype: collection\ncollectionCreator: ${nombre}\nfiles:\n  - texto.md\n---\n\nIntro.\n`);
});

Given('otra colección con el mismo texto', () => {
  escribirEnProyecto('otra.md', '---\ntitle: Otra\ntype: collection\nfiles:\n  - texto.md\n---\n');
});

Given('otra lista con el mismo texto', () => {
  escribirEnProyecto('otra-lista.md', '---\ntitle: Otra lista\ntype: list\nfiles:\n  - texto.md\n---\n');
});

Given('el texto está en una lista', () => {
  escribirEnProyecto('mi-lista.md', '---\ntitle: Mi lista\ntype: list\nfiles:\n  - texto.md\n---\n');
});

Given('el texto es de una colección y de una lista', () => {
  escribirEnProyecto('antologia.md', '---\ntitle: Antología\ntype: collection\nfiles:\n  - texto.md\n---\n');
  escribirEnProyecto('mi-lista.md', '---\ntitle: Mi lista\ntype: list\nfiles:\n  - texto.md\n---\n');
});

Given('el proyecto produce html', () => {
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  html:\n    generate: true\n');
});

When('calculo los enlaces de las creadoras con:', (tabla: string) => {
  const datos = JSON.parse(tabla.replace(/<br>/g, '\n')) as Record<string, string>;
  world.enlacesCreador = new Map(Object.entries(datos));
});

When('los nombres enlazados son {string}', (nombres: string) => {
  const lista = nombres
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  world.nombresEnlazados = nombresEnlazados(lista, world.enlacesCreador as Map<string, string>);
});

Then('el nombre enlazado es {string}', (esperado: string) => {
  const leidos = (world.nombresEnlazados as string[]).join(', ');
  if (leidos !== esperado) {
    throw new Error(`el nombre enlazado es ${JSON.stringify(leidos)} y debería ser ${JSON.stringify(esperado)}`);
  }
});

Then('el HTML del texto pone {string} antes que {string}', (primero: string, segundo: string) => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'un-texto-por-ana-garcia.html'), 'utf8');
  const a = html.indexOf(primero);
  const b = html.indexOf(segundo);
  if (a < 0) throw new Error(`el HTML no tiene ${JSON.stringify(primero)}`);
  if (b < 0) throw new Error(`el HTML no tiene ${JSON.stringify(segundo)}`);
  if (a >= b) throw new Error(`${JSON.stringify(primero)} (${a}) no va antes que ${JSON.stringify(segundo)} (${b})`);
});

Then('la biografía del texto está fuera de su artículo', () => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'un-texto-por-ana-garcia.html'), 'utf8');
  const article = html.indexOf('<article');
  const fin = html.indexOf('</article>');
  const bio = html.indexOf('Bio de Ana García.');
  if (article < 0 || fin < 0) throw new Error('el texto no tiene artículo');
  if (bio < 0) throw new Error('el texto no tiene la biografía');
  if (bio < fin) throw new Error('la biografía sigue dentro del artículo');
});

Then('la biografía del texto está en su propia tarjeta', () => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'un-texto-por-ana-garcia.html'), 'utf8');
  const bio = html.indexOf('Bio de Ana García.');
  const antes = html.slice(0, bio);
  const wrapper = antes.lastIndexOf('break-inside-avoid');
  if (wrapper < 0) {
    throw new Error('la biografía no está dentro de una tarjeta del masonry');
  }
  const finArticulo = html.indexOf('</article>');
  if (finArticulo >= 0 && wrapper < finArticulo) {
    throw new Error('la biografía sigue dentro de la tarjeta del texto');
  }
});

Then('la tarjeta de las colecciones lleva el chip {string}', (chip: string) => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'un-texto-por-ana-garcia.html'), 'utf8');
  if (!html.includes(`>${chip}</a>`)) {
    throw new Error(`la tarjeta de las colecciones no lleva el chip ${JSON.stringify(chip)}`);
  }
});

Then('la tarjeta de las colecciones no lleva el chip {string}', (chip: string) => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'un-texto-por-ana-garcia.html'), 'utf8');
  if (html.includes(`>${chip}</a>`)) {
    throw new Error(`la tarjeta de las colecciones sí lleva el chip ${JSON.stringify(chip)}`);
  }
});

Then('el chip {string} enlaza a {string}', (chip: string, destino: string) => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'un-texto-por-ana-garcia.html'), 'utf8');
  const patron = new RegExp(`>${chip}</a>`);
  const match = patron.exec(html);
  if (match === null) throw new Error(`no hay ningún chip ${JSON.stringify(chip)}`);
  const antes = html.slice(0, match.index);
  const href = antes.lastIndexOf('href="');
  if (href < 0) throw new Error(`el chip ${JSON.stringify(chip)} no es un enlace`);
  const enlazado = antes.slice(href + 'href="'.length).split('"')[0];
  if (enlazado !== destino) {
    throw new Error(`el chip ${JSON.stringify(chip)} enlaza a ${JSON.stringify(enlazado)} y debería a ${JSON.stringify(destino)}`);
  }
});

Then('la página de la creadora lleva la tarjeta de textos', () => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'ana-garcia.html'), 'utf8');
  if (!html.includes('>Textos</a>')) {
    throw new Error('la página de la creadora no lleva la tarjeta de textos');
  }
});

Then('la página de la creadora no lleva la tarjeta de textos', () => {
  const archivo = join(world.root, 'dist', 'files', 'ana-garcia.html');
  if (!existsSync(archivo)) return;
  const html = readFileSync(archivo, 'utf8');
  if (html.includes('>Textos</a>')) {
    throw new Error('la página de la creadora no debería llevar la tarjeta de textos');
  }
});
