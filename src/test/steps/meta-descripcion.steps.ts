import { Given } from '@cucumber/cucumber';
import { escribirEnProyecto, raiz } from './cli-world.steps.js';

function proyecto(descripcionPropia: boolean): void {
  raiz();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    [
      'language: es-MX',
      'format:',
      '  html:',
      '    site:',
      '      title: Sitio',
      '      description: Sitio de prueba',
      '    generate: true',
    ].join('\n'),
  );
  const frontmatter = ['---', 'title: Test Document'];
  if (descripcionPropia) frontmatter.push('description: Descripción de prueba');
  frontmatter.push('---', '', 'Contenido de prueba.');
  escribirEnProyecto('test.md', `${frontmatter.join('\n')}\n`);
}

Given('que la raíz del proyecto tiene un proyecto con HTML y descripción propia', () => {
  proyecto(true);
});

Given('que la raíz del proyecto tiene un proyecto con HTML y descripción del sitio', () => {
  proyecto(false);
});
