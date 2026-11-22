import { Given } from '@cucumber/cucumber';
import { escribirEnProyecto } from './cli-world.steps.ts';

const CONFIG = ['language: es-MX', 'format:', '  html:', '    site:', '      title: Estático', '    generate: true'].join('\n');

Given('un proyecto con una carpeta static', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${CONFIG}\n`);
  escribirEnProyecto('index.md', '---\ntitle: Inicio\n---\n\nContenido.\n');
  escribirEnProyecto('static/_redirects', '/viejo /nuevo 301\n');
  escribirEnProyecto('static/assets/files/libro.pdf', 'PDF');
  escribirEnProyecto('static/index.html', '<!doctype html><title>estático</title>\n');
  escribirEnProyecto('static/nota.md', '---\ntitle: No\n---\n');
});
