import { Given } from '@cucumber/cucumber';
import { writeHtmlConfig } from '../helpers.js';
import { escribirEnProyecto, raiz } from './cli-world.steps.js';

Given('que la raíz del proyecto tiene un proyecto con HTML y URL base', () => {
  writeHtmlConfig(raiz(), { url: 'https://ejemplo.org/revista' });
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido.\n');
});

Given('que la raíz del proyecto tiene un proyecto con HTML sin URL base', () => {
  writeHtmlConfig(raiz());
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido.\n');
});

Given('que la raíz del proyecto tiene un proyecto con HTML, URL base y colección paginada', () => {
  writeHtmlConfig(raiz(), { url: 'https://ejemplo.org/revista', pageSize: 1 });
  escribirEnProyecto('uno.md', '---\ntitle: Uno\n---\n\nPrimero.\n');
  escribirEnProyecto('dos.md', '---\ntitle: Dos\n---\n\nSegundo.\n');
  escribirEnProyecto('libro.md', '---\ntitle: Libro\ntype: collection\nfiles:\n  - uno.md\n  - dos.md\n---\n\nIntro.\n');
});
