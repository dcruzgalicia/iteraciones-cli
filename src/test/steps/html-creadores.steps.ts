import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { nombresEnlazados } from '../../builder/pipeline-formats.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

Given('una creadora llamada {string}', (nombre: string) => {
  escribirEnProyecto('ana-garcia.md', `---\ntype: creator\nname: ${nombre}\n---\n\nBio de ${nombre}.\n`);
});

Given('tres creadoras con fechas: {string} en 2026, {string} en 2020 y {string} sin fecha', (reciente: string, vieja: string, sinFecha: string) => {
  const creadora = (nombre: string, extra: string): string => `---\ntype: creator\nname: ${nombre}\n${extra}---\n\nBio de ${nombre}.\n`;
  escribirEnProyecto('zoe.md', creadora(reciente, 'date: 2026-03-01\n'));
  escribirEnProyecto('ana.md', creadora(vieja, 'date: 2020-01-01\n'));
  escribirEnProyecto('marta.md', creadora(sinFecha, ''));
});

Then('la lista {string} ordena a {string}', (archivo: string, nombres: string) => {
  const html = readFileSync(join(world.root, archivo), 'utf8');
  const leidos = [...html.matchAll(/<h3[^>]*>(?:<a[^>]*>)?([^<]+)/g)].map((m) => (m[1] ?? '').trim());
  const esperados = nombres.split(',').map((n) => n.trim());
  if (JSON.stringify(leidos) !== JSON.stringify(esperados)) {
    throw new Error(`la lista ordena ${JSON.stringify(leidos)} y debería ${JSON.stringify(esperados)}`);
  }
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

Then('el nombre de la creadora en la biografía es un enlace', () => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'un-texto-por-ana-garcia.html'), 'utf8');
  const bio = html.indexOf('Bio de Ana García.');
  if (bio < 0) throw new Error('la página no tiene la biografía de la creadora');
  const antes = html.slice(0, bio);
  const titulo = html.slice(antes.lastIndexOf('<h2'), bio);
  if (!titulo.includes('<a href="./ana-garcia.html"')) {
    throw new Error(`el nombre de la creadora no es un enlace: ${titulo}`);
  }
});

Then('la tarjeta de las colecciones lleva el chip {string}', (chip: string) => {
  const html = readFileSync(join(world.root, 'dist', 'files', 'un-texto-por-ana-garcia.html'), 'utf8');
  const match = new RegExp(`<h2 class="([^"]*)">[^<]*<a[^>]*>${chip}</a>`).exec(html);
  if (match === null) {
    throw new Error(`la tarjeta de las colecciones no lleva el chip ${JSON.stringify(chip)}`);
  }
  // El chip controla sus márgenes (sin el margen superior del h2) y deja aire
  // antes del elemento que sigue.
  if (!match[1]?.includes('mt-0') || !/\bmb-\d/.test(match[1] ?? '')) {
    throw new Error(`el chip ${JSON.stringify(chip)} conserva los márgenes del h2: ${match[1]}`);
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

Then('la página de la creadora no lleva la tarjeta de textos', () => {
  const archivo = join(world.root, 'dist', 'files', 'ana-garcia.html');
  if (!existsSync(archivo)) return;
  const html = readFileSync(archivo, 'utf8');
  if (html.includes('>Textos</a>')) {
    throw new Error('la página de la creadora no debería llevar la tarjeta de textos');
  }
});
