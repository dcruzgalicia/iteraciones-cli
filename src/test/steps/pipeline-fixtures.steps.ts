import { spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import * as pandocRunner from '../../lib/pandoc-runner.js';

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

type ReporterCall = { method: string; args: unknown[] };

function fakeReporter(calls: ReporterCall[]): Parameters<typeof build>[2] {
  return {
    setFormats: (formats: unknown[]) => void calls.push({ method: 'setFormats', args: [formats] }),
    planPhases: (phases: string[]) => {
      calls.push({ method: 'planPhases', args: [phases] });
      return Promise.resolve();
    },
    startPhase: (phase: string, total?: number) => void calls.push({ method: 'startPhase', args: [phase, total] }),
    reportFile: (file: unknown) => void calls.push({ method: 'reportFile', args: [file] }),
    completePhase: (count?: number) => void calls.push({ method: 'completePhase', args: [count] }),
    log: (message: string) => void calls.push({ method: 'log', args: [message] }),
    addWarning: (message: string) => void calls.push({ method: 'warn', args: [message] }),
    addSummaryLine: (line: string) => void calls.push({ method: 'summary', args: [line] }),
    showCleanup: () => void calls.push({ method: 'cleanup', args: [] }),
    startLightFormats: () => void calls.push({ method: 'light', args: [] }),
    finish: (processed: number, cached: number) => {
      calls.push({ method: 'finish', args: [processed, cached] });
      return Promise.resolve();
    },
    fail: () => {
      calls.push({ method: 'fail', args: [] });
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof build>[2];
}

interface PipelineWorld {
  dir: string;
  calls: ReporterCall[];
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
  await build(world.dir, {}, fakeReporter(world.calls));
});

function methods(): string[] {
  return world.calls.map((c) => c.method);
}

Then('el reporter recibe setFormats, planPhases y finish, y ninguna fase de fallo', () => {
  if (methods().includes('fail')) throw new Error('el reporter recibió una fase de fallo');
  for (const esperado of ['setFormats', 'planPhases', 'finish']) {
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
