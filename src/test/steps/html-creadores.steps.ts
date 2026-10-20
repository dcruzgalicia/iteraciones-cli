import { readFileSync } from 'node:fs';
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
