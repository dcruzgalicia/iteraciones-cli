import { Given } from '@cucumber/cucumber';
import { escribirEnProyecto, raiz } from './cli-world.steps.js';

function proyectoConFechas(siteShowDates: boolean, docShowDates?: boolean): void {
  raiz();
  const config = ['language: es-MX', 'format:', '  html:', '    site:', '      title: Fechas'];
  if (siteShowDates) config.push('      showDates: true');
  config.push('    generate: true');
  escribirEnProyecto('iteraciones.config.yaml', `${config.join('\n')}\n`);

  const frontmatter = ['---', 'title: Test Document', 'date: 2026-01-01'];
  if (docShowDates !== undefined) frontmatter.push(`showDates: ${docShowDates}`);
  frontmatter.push('---', '', 'Contenido de prueba.');
  escribirEnProyecto('test.md', `${frontmatter.join('\n')}\n`);
}

Given('que la raíz del proyecto tiene un proyecto con HTML y fechas', () => {
  proyectoConFechas(false);
});

Given('que la raíz del proyecto tiene un proyecto con HTML y fechas globales', () => {
  proyectoConFechas(true);
});

Given('que la raíz del proyecto tiene un proyecto con HTML, fechas globales y el documento las oculta', () => {
  proyectoConFechas(true, false);
});

Given('que la raíz del proyecto tiene un proyecto con HTML y el documento muestra las fechas', () => {
  proyectoConFechas(false, true);
});
