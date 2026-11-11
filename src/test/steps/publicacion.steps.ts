import { Given } from '@cucumber/cucumber';
import { escribirEnProyecto, raiz } from './cli-world.steps.js';

function config(): void {
  raiz();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    ['language: es-MX', 'format:', '  html:', '    site:', '      title: Sitio', '    generate: true'].join('\n'),
  );
}

Given('que la raíz del proyecto tiene un proyecto con HTML y metadatos de publicación', () => {
  config();
  escribirEnProyecto(
    'test.md',
    [
      '---',
      'title: Test Document',
      'abstract: Un resumen de la publicación.',
      'isbn: 978-607-00-0000-0',
      'publisher: Editorial de prueba',
      'doi: 10.1234/ejemplo',
      'rights: Algunos derechos reservados.',
      'keywords:',
      '  - pruebas',
      '---',
      '',
      'Contenido.',
    ].join('\n'),
  );
});

Given('que la raíz del proyecto tiene un proyecto con HTML y sólo el título', () => {
  config();
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido.\n');
});
