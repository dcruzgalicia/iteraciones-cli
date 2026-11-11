import { Given } from '@cucumber/cucumber';
import { escribirEnProyecto, raiz } from './cli-world.steps.js';

function config(): void {
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
}

Given('que la raíz del proyecto tiene un proyecto con HTML, URL base, fecha y autora', () => {
  config();
  escribirEnProyecto(
    'test.md',
    '---\ntitle: Test Document\ndescription: Descripción de prueba\ncreator:\n  - Ana Ruiz\ndate: 2026-01-01\n---\n\nContenido.\n',
  );
});

Given('que la raíz del proyecto tiene un proyecto con HTML, URL base y creadora', () => {
  config();
  escribirEnProyecto('creadora.md', '---\nname: Ana Ruiz\ntype: creator\n---\n\nBio de Ana.\n');
});
