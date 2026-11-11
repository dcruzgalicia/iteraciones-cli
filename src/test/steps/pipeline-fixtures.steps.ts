import { spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import * as pandocRunner from '../../lib/pandoc-runner.js';
import { fakeReporter } from '../helpers.js';

const CONFIG = [
  'language: es-MX',
  'format:',
  '  html:',
  '    generate: false',
  '  latex:',
  '    generate: true',
  '  epub:',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

interface PipelineWorld {
  dir: string;
  calls: ReturnType<typeof fakeReporter>['calls'];
}

const world: PipelineWorld = { dir: '', calls: [] };

let espiaVersion: ReturnType<typeof spyOn> | undefined;

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

Given('un proyecto con LaTeX, EPUB y Markdown activados y HTML desactivado', async () => {
  await Bun.write(join(world.dir, 'iteraciones.config.yaml'), `${CONFIG}\n`);
  await Bun.write(join(world.dir, 'test-document.md'), '---\ntitle: "Test Document"\n---\n\nTexto.\n');
});

Before({ tags: '@spy-pipeline' }, () => {
  world.calls = [];

  espiaVersion = spyOn(pandocRunner, 'getPandocVersion');
});

When('compilo el proyecto con un reporter que cuenta eventos', async () => {
  process.exitCode = 0;
  const fake = fakeReporter();
  world.calls = fake.calls;
  await build(world.dir, {}, fake.reporter);
});

function methods(): string[] {
  return world.calls.map((c) => c.method);
}

Then('el reporter recibe setFormats y finish, y ninguna fase de fallo', () => {
  if (methods().includes('fail')) throw new Error('el reporter recibió una fase de fallo');
  for (const esperado of ['setFormats', 'finish']) {
    if (!methods().includes(esperado)) throw new Error(`el reporter nunca recibió ${esperado}. Recibió: ${JSON.stringify(methods())}`);
  }
});

Then('el reporter recibe las fases de discovery y de render', () => {
  const starts = world.calls.filter((c) => c.method === 'startPhase').map((c) => c.args[0]);
  for (const phase of ['discovery', 'render']) {
    if (!starts.includes(phase)) throw new Error(`el reporter no recibió la fase ${phase}. Recibió: ${JSON.stringify(starts)}`);
  }
});

Then('el reporter declara el render con el total de documentos', () => {
  const render = world.calls.find((c) => c.method === 'startPhase' && c.args[0] === 'render');
  if (render === undefined) throw new Error('el reporter nunca recibió el inicio de la fase render');
  if (render.args[1] !== 1) throw new Error(`esperaba render con total 1 documento y fue ${String(render.args[1])}`);
});

Then('el reporter cierra con un documento procesado y ninguno en caché', () => {
  const finish = world.calls.find((c) => c.method === 'finish');
  if (finish === undefined) throw new Error('el reporter nunca cerró');
  if (finish.args[0] !== 1) throw new Error(`esperaba 1 documento procesado y fueron ${String(finish.args[0])}`);
  if (finish.args[1] !== 0) throw new Error(`esperaba 0 en caché y hubo ${String(finish.args[1])}`);
});

Then('pandoc se consulta una sola vez por build', () => {
  const veces = espiaVersion?.mock.calls.length ?? 0;
  if (veces !== 1) throw new Error(`pandoc se consultó ${veces} veces y debía una`);
});
