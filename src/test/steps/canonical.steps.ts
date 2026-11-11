import { Given } from '@cucumber/cucumber';
import { escribirEnProyecto, raiz } from './cli-world.steps.js';

function config(conUrl: boolean, pageSize?: number): void {
  raiz();
  const lineas = ['language: es-MX', 'format:', '  html:', '    site:', '      title: Sitio'];
  if (conUrl) lineas.push('      url: https://ejemplo.org/revista');
  lineas.push('    generate: true');
  if (pageSize !== undefined) lineas.push(`    pageSize: ${pageSize}`);
  escribirEnProyecto('iteraciones.config.yaml', `${lineas.join('\n')}\n`);
}

Given('que la raíz del proyecto tiene un proyecto con HTML y URL base', () => {
  config(true);
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido.\n');
});

Given('que la raíz del proyecto tiene un proyecto con HTML sin URL base', () => {
  config(false);
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido.\n');
});

Given('que la raíz del proyecto tiene un proyecto con HTML, URL base y colección paginada', () => {
  config(true, 1);
  escribirEnProyecto('uno.md', '---\ntitle: Uno\n---\n\nPrimero.\n');
  escribirEnProyecto('dos.md', '---\ntitle: Dos\n---\n\nSegundo.\n');
  escribirEnProyecto('libro.md', '---\ntitle: Libro\ntype: collection\nfiles:\n  - uno.md\n  - dos.md\n---\n\nIntro.\n');
});
