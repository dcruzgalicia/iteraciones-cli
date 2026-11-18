import { Given } from '@cucumber/cucumber';
import { writeHtmlConfig } from '../helpers.js';
import { escribirEnProyecto, raiz } from './cli-world.steps.js';

function proyecto(rss: boolean): void {
  writeHtmlConfig(raiz(), { description: 'Descripción del sitio', url: 'https://ejemplo.org/revista', rss });
  escribirEnProyecto('test.md', '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido.\n');
}

Given('que la raíz del proyecto tiene un proyecto con HTML, URL base y RSS', () => {
  proyecto(true);
});

Given('que la raíz del proyecto tiene un proyecto con HTML, URL base y sin RSS', () => {
  proyecto(false);
});
