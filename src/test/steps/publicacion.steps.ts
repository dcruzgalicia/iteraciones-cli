import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { escribirEnProyecto, raiz, world } from './cli-world.steps.js';

function config(showCitation: boolean): void {
  raiz();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    ['language: es-MX', 'format:', '  html:', '    site:', '      title: Sitio', `      showCitation: ${showCitation}`, '    generate: true'].join('\n'),
  );
}

function metadatos(): void {
  escribirEnProyecto(
    'test.md',
    [
      '---',
      'title: Test Document',
      'abstract: Un resumen de la publicación.',
      'isbn: 978-607-00-0000-0',
      'publisher: Editorial de prueba',
      'doi: 10.1234/ejemplo',
      'contributor:',
      '  - Ana',
      '  - Otra',
      'identifier: https://example.com/id',
      'rights: Algunos derechos reservados.',
      'keywords:',
      '  - pruebas',
      '---',
      '',
      'Contenido.',
    ].join('\n'),
  );
}

Given('que la raíz del proyecto tiene un proyecto con HTML y metadatos de publicación', () => {
  config(true);
  metadatos();
});

Given('que la raíz del proyecto tiene un proyecto con HTML y metadatos de publicación sin cita', () => {
  config(false);
  metadatos();
});

Given('que la raíz del proyecto tiene un proyecto con HTML y sólo el título', () => {
  config(false);
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido.\n');
});

function slotHtml(archivo: string, slot: string): string {
  const html = readFileSync(join(world.root, archivo), 'utf8');
  const start = html.indexOf(`id="slot-${slot}"`);
  if (start < 0) return '';
  const ends =
    slot === 'related'
      ? [html.indexOf('id="slot-sidebar"', start), html.indexOf('</aside>', start)]
      : [html.indexOf('</aside>', start)];
  const end = ends.filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return html.slice(start, end ?? undefined);
}

Then('el slot {string} del archivo {string} no contiene {string}', (slot: string, archivo: string, texto: string) => {
  if (slotHtml(archivo, slot).includes(texto)) throw new Error(`el slot ${slot} contiene ${JSON.stringify(texto)} y no debía`);
});

Then('el slot {string} del archivo {string} contiene {string}', (slot: string, archivo: string, texto: string) => {
  if (!slotHtml(archivo, slot).includes(texto)) throw new Error(`el slot ${slot} no contiene ${JSON.stringify(texto)}`);
});
