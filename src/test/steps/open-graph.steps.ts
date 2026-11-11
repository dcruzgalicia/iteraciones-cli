import { Given } from '@cucumber/cucumber';
import { escribirEnProyecto, raiz } from './cli-world.steps.js';

Given('que la raíz del proyecto tiene un proyecto con HTML, URL base y descripción propia', () => {
  raiz();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    [
      'language: es-MX',
      'format:',
      '  html:',
      '    site:',
      '      title: Sitio',
      '      url: https://ejemplo.org/revista',
      '    generate: true',
    ].join('\n'),
  );
  escribirEnProyecto('test.md', '---\ntitle: Test Document\ndescription: Descripción de prueba\n---\n\nContenido.\n');
});
