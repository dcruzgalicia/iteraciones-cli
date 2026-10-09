import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Before, Given, Then, When } from '@cucumber/cucumber';
import { insertAuthorsBlock } from '../../builder/latex-composer.js';
import { build } from '../../builder/orchestrator.js';
import { capture, escribirEnProyecto, tempRoot, world } from './cli-world.steps.js';

const CONFIG = ['language: es-MX', 'format:', '  latex:', '    generate: true'].join('\n');

const CONFIG_BIB = ['language: es-MX', 'bibliography: bibliography.bib', 'format:', '  latex:', '    generate: true'].join('\n');

const COLECCION = ['---', 'title: Antología', 'type: collection', 'collectionCreator: Editora', 'files:', '  - cap1.md', '---', '', 'Índice.'].join(
  '\n',
);

const local = { tex: '', archivo: '', bloque: '', insertado: '' };

Before(() => {
  world.root = tempRoot('iteraciones-autores-');
});

function proyecto(cuerpo: string): void {
  escribirEnProyecto('coleccion.md', COLECCION);
  escribirEnProyecto('cap1.md', `---\ntitle: Capítulo Uno\ncreator: Ana García\n---\n\n${cuerpo}\n`);
  escribirEnProyecto('ana.md', '---\ntype: creator\nname: Ana García\n---\n\nBio de Ana.\n');
}

Given('el proyecto de una collection con una creadora', () => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG);
  proyecto('Contenido.');
});

Given('el proyecto de una collection que cita su bibliografía', () => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG_BIB);
  escribirEnProyecto('bibliography.bib', '@book{k1, title={T}, author={Ana García}}\n');
  proyecto('Contenido [@k1].');
});

Given('el proyecto no tiene el archivo {string}', (relativa: string) => {
  rmSync(join(world.root, relativa));
});

When('compilo el proyecto para leer su LaTeX', async () => {
  await capture(() => build(world.root, {}));
  local.archivo = 'antologia-por-editora.tex';
  local.tex = readFileSync(join(world.root, 'dist', 'files', local.archivo), 'utf8');
});

function texDe(archivo: string): string {
  if (archivo !== local.archivo) {
    throw new Error(`el paso leyó ${JSON.stringify(local.archivo)} y el escenario pregunta por ${JSON.stringify(archivo)}`);
  }
  return local.tex;
}

Then('el LaTeX de {string} tiene {string}', (archivo: string, texto: string) => {
  if (!texDe(archivo).includes(texto)) {
    throw new Error(`el .tex no tiene ${JSON.stringify(texto)}`);
  }
});

Then('el LaTeX de {string} no tiene {string}', (archivo: string, texto: string) => {
  if (texDe(archivo).includes(texto)) {
    throw new Error(`el .tex sí tiene ${JSON.stringify(texto)} y no debería`);
  }
});

Then('el bloque va antes de {string}', (ancla: string) => {
  const bloque = local.tex.indexOf('Autoras y colaboradoras');
  const donde = local.tex.indexOf(ancla);
  if (bloque === -1) throw new Error('el .tex no tiene el bloque de autoras');
  if (donde === -1) throw new Error(`el .tex no tiene el ancla ${JSON.stringify(ancla)}`);
  if (bloque > donde) {
    throw new Error(`el bloque está en ${bloque} y el ancla en ${donde}: quedó después`);
  }
});

Given('el LaTeX de la colección es {string}', (tex: string) => {
  local.tex = tex;
});

Given('el bloque de autoras es {string}', (bloque: string) => {
  local.bloque = bloque;
});

When('inserto el bloque de autoras', async () => {
  await capture(async () => {
    local.insertado = insertAuthorsBlock(local.tex, local.bloque);
  });
});

Then('el bloque de autoras quedó justo antes de {string}', (ancla: string) => {
  const bloque = local.insertado.indexOf(local.bloque);
  const donde = local.insertado.indexOf(ancla);
  if (bloque === -1) throw new Error('el bloque no quedó en el LaTeX');
  if (donde === -1) throw new Error(`el LaTeX no tiene el ancla ${JSON.stringify(ancla)}`);
  if (donde < bloque || donde - bloque > local.bloque.length + 4) {
    throw new Error(`el bloque quedó en ${bloque} y el ancla en ${donde}: no está justo antes`);
  }
});

Then('el bloque de autoras insertado es {string}', (esperado: string) => {
  if (local.insertado !== esperado) {
    throw new Error(`quedó ${JSON.stringify(local.insertado)} y esperaba ${JSON.stringify(esperado)}`);
  }
});

Then('el aviso del bloque dice {string}', (texto: string) => {
  if (!world.stderr.includes(texto)) {
    throw new Error(`stderr no dice ${JSON.stringify(texto)}. Va: ${JSON.stringify(world.stderr)}`);
  }
});

Then('ningún aviso del bloque dice {string}', (texto: string) => {
  if (world.stderr.includes(texto)) {
    throw new Error(`stderr sí dice ${JSON.stringify(texto)}. Va: ${JSON.stringify(world.stderr)}`);
  }
});
