import { Given, Then, When } from '@cucumber/cucumber';
import { runMarkdown } from '../../cli/markdown.js';
import { runMerge } from '../../cli/merge.js';
import { capture, escribirEnProyecto, tempRoot, world } from './cli-world.steps.ts';

const CONFIG = ['language: es-MX', 'format:', '  markdown:', '    generate: true'].join('\n');

const ROTO = ['---', 'title: Roto', 'meta:', '  autor: A', ' subtitulo: B', '---', '', 'Cuerpo.'].join('\n');

Given('que un documento con frontmatter mal formado', () => {
  world.root = tempRoot('iteraciones-cli-');
  escribirEnProyecto('iteraciones.config.yaml', CONFIG);
  escribirEnProyecto('roto.md', ROTO);
});

When('fusiono el documento mal formado', async () => {
  await capture(async () => {
    await runMerge(world.root, 'roto.md', { format: 'markdown', output: 'out.md' });
  });
});

When('convierto el documento mal formado a markdown', async () => {
  await capture(async () => {
    await runMarkdown(world.root, 'roto.md', { output: 'out.md' });
  });
});

Then('el error dice que los items del mapeo deben empezar en la misma columna', () => {
  const esperado = 'los items del mapeo deben empezar en la misma columna';
  if (!world.stderr.includes(esperado)) {
    throw new Error(`stderr no dice ${JSON.stringify(esperado)}: ${JSON.stringify(world.stderr)}`);
  }
});

Then('el error no dice nada en inglés', () => {
  const ruido = ['YAML Parse error', 'Unexpected token', 'Map keys', 'at line', 'at column'];
  const encontrados = ruido.filter((r) => world.stderr.includes(r));
  if (encontrados.length > 0) {
    throw new Error(`stderr filtra ${JSON.stringify(encontrados)} en inglés: ${JSON.stringify(world.stderr)}`);
  }
});
