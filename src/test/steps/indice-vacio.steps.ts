import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { capture, escribirEnProyecto, tempRoot, world } from './cli-world.steps.js';

const CONFIG = ['language: es-MX', 'toc: true', 'format:', '  latex:', '    generate: true'].join('\n');

Before(() => {
  world.root = tempRoot('iteraciones-indice-');
});

Given('un proyecto de LaTeX con tocdepth {int}', (tocdepth: number) => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG);
  escribirEnProyecto('preamble/12-counters.tex', `\\setcounter{secnumdepth}{-2}\n\\setcounter{tocdepth}{${tocdepth}}\n`);
});

Given('un proyecto de LaTeX sin tocdepth', () => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG);
});

Given('un texto con el encabezado {string}', (encabezado: string) => {
  escribirEnProyecto('texto.md', `---\ntitle: Un texto\n---\n\nCuerpo.\n\n${encabezado}\n\nMás texto.\n`);
});

Given('un texto con el encabezado {string} y con creadora', (encabezado: string) => {
  escribirEnProyecto('texto.md', `---\ntitle: Un texto\ncreator: Ana García\n---\n\nCuerpo.\n\n${encabezado}\n\nMás texto.\n`);
  escribirEnProyecto('ana.md', '---\ntype: creator\nname: Ana García\n---\n\nBio de Ana.\n');
});

Given('una colección con un miembro', () => {
  escribirEnProyecto('texto.md', '---\ntitle: Un texto\n---\n\nCuerpo.\n');
  escribirEnProyecto('coleccion.md', '---\ntitle: Colección\ntype: collection\nfiles:\n  - texto.md\n---\n');
});

When('compilo el proyecto para leer el índice', async () => {
  await capture(() => build(world.root, {}));
});

function texDe(archivo: string): string {
  return readFileSync(join(world.root, 'dist', 'files', archivo), 'utf8');
}

Then('el LaTeX de {string} tiene el índice', (archivo: string) => {
  if (!texDe(archivo).includes('\\tableofcontents')) {
    throw new Error('el .tex no tiene el índice');
  }
});

Then('el LaTeX de {string} no tiene el índice', (archivo: string) => {
  const tex = texDe(archivo);
  if (tex.includes('\\tableofcontents')) {
    const tocdepth = tex.match(/\\setcounter\{tocdepth\}\{\d+\}/g) ?? [];
    throw new Error(
      `el .tex sí tiene el índice y no debería. ${tocdepth.join(' ')}\n${tex.slice(0, 400)}\n...archivos: ${readdirSync(join(world.root, 'dist', 'files')).join(', ')}`,
    );
  }
});

Then('el LaTeX de {string} contiene {string}', (archivo: string, texto: string) => {
  if (!texDe(archivo).includes(texto)) {
    throw new Error(`el .tex no tiene ${JSON.stringify(texto)}`);
  }
});
