import { Given } from '@cucumber/cucumber';
import { writeHtmlConfig } from '../helpers.js';
import { escribirEnProyecto, raiz } from './cli-world.steps.js';

Given('que la raíz del proyecto tiene un proyecto con HTML, URL base, fecha y autora', () => {
  writeHtmlConfig(raiz(), { url: 'https://ejemplo.org/revista' });
  escribirEnProyecto(
    'test.md',
    '---\ntitle: Test Document\ndescription: Descripción de prueba\ncreator:\n  - Ana Ruiz\ndate: 2026-01-01\n---\n\nContenido.\n',
  );
});

Given('que la raíz del proyecto tiene un proyecto con HTML, URL base y creadora', () => {
  writeHtmlConfig(raiz(), { url: 'https://ejemplo.org/revista' });
  escribirEnProyecto('creadora.md', '---\nname: Ana Ruiz\ntype: creator\n---\n\nBio de Ana.\n');
});
