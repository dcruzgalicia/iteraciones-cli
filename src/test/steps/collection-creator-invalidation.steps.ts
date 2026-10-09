import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Before, Given, Then, When } from '@cucumber/cucumber';
import { runBuild } from '../../cli/dispatcher.js';
import { capture, escribirEnProyecto, tempRoot, world } from './cli-world.steps.js';

const CONFIG = ['language: es-MX', 'format:', '  html:', '    site:', '      title: T', '    generate: true'].join('\n');

interface Local {
  processed: number;
  errores: string;
}

const local: Local = { processed: -1, errores: '' };

async function build(): Promise<void> {
  const original = process.exitCode;
  local.errores = '';
  try {
    await capture(() => runBuild(world.root, { json: true }));
  } catch (err) {
    local.errores += `${err instanceof Error ? err.message : String(err)}\n`;
  }
  const json = JSON.parse(world.stdout.trim() || '{}') as { processed?: number };
  local.processed = json.processed ?? -1;
  process.exitCode = original;
}

Before(() => {
  world.root = tempRoot('iteraciones-creators-');
});

Given('que el proyecto tiene una collection con una creadora', () => {
  escribirEnProyecto('iteraciones.config.yaml', CONFIG);
  escribirEnProyecto(
    'coleccion.md',
    ['---', 'title: Antología', 'type: collection', 'collectionCreator: Editora', 'files:', '  - cap1.md', '---', '', 'Índice.'].join('\n'),
  );
  escribirEnProyecto('cap1.md', '---\ntitle: Capítulo Uno\ncreator: Ana García\n---\n\nContenido.\n');
  escribirEnProyecto('ana.md', '---\ntype: creator\nname: Ana García\n---\n\nBio original.\n');
});

When('construyo el proyecto con sus creators', build);
When('construyo el proyecto con sus creators otra vez', build);

When('edito el archivo de la creadora', () => {
  escribirEnProyecto('ana.md', '---\ntype: creator\nname: Ana García\n---\n\nBio corregida.\n');
});

When('cambio el nombre de la creadora', () => {
  escribirEnProyecto('ana.md', '---\ntype: creator\nname: Betsy Ruiz\n---\n\nBio de Betsy.\n');
});

When('agrego una creadora que no coincide con nadie', () => {
  escribirEnProyecto('zombie.md', '---\ntype: creator\nname: Zombie Nadie\n---\n\nBio zombie.\n');
});

When('agrego un miembro nuevo a la collection', () => {
  escribirEnProyecto('cap2.md', '---\ntitle: Capítulo Dos\ncreator: Ana García\n---\n\nSegundo capítulo.\n');
  escribirEnProyecto(
    'coleccion.md',
    ['---', 'title: Antología', 'type: collection', 'collectionCreator: Editora', 'files:', '  - cap1.md', '  - cap2.md', '---', '', 'Índice.'].join(
      '\n',
    ),
  );
});

When('borro el archivo de la creadora', () => {
  rmSync(join(world.root, 'ana.md'));
});

When('edito un miembro de files[] de la collection', () => {
  escribirEnProyecto('cap1.md', '---\ntitle: Capítulo Uno\ncreator: Ana García\n---\n\nContenido corregido.\n');
});

Then('se reconstruyen {int} documentos', (docs: number) => {
  if (local.processed !== docs) {
    throw new Error(`se reconstruyeron ${local.processed} y esperaba ${docs}. errores: ${local.errores}`);
  }
});

Then('la collection {string} declara las creator docs {string}', (coleccion: string, esperadas: string) => {
  const estado = JSON.parse(readFileSync(join(world.root, '.iteraciones', 'state.json'), 'utf8')) as {
    entries: Record<string, { creatorDocs?: string[] }>;
  };
  const lista = estado.entries[coleccion]?.creatorDocs ?? [];
  const esperado = esperadas
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
  if (JSON.stringify([...lista].sort()) !== JSON.stringify(esperado)) {
    throw new Error(`creatorDocs=${JSON.stringify(lista)} y esperaba ${JSON.stringify(esperado)}`);
  }
});
