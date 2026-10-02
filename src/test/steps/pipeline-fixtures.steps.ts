import { spyOn } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import * as pandocRunner from '../../lib/pandoc-runner.js';

/**
 * #2545 (onda 1) — pipeline completo sin procesos.
 *
 * El espío va en un hook con tag (`@spy-pipeline`) por lo que Peaks
 * descubrió #2556: los hooks de cucumber son globales en cuanto se importa el
 * archivo, así que un `Before` normal espiaría `execPandoc` para todos los
 * features — incluido `build-script.feature`, que necesita pandoc de verdad.
 *
 * El reporter falso se copia del original. Es un doble grande (doce métodos que
 * sólo registran), pero está pegado a la forma de `BuildReporter`: si la
 * interfaz cambia, TypeScript lo dice en los sites de llamada. Encapsularlo
 * detrás de una clase sería más bonito y menos honesto.
 */

const FIXTURE_LATEX = '\\subsection{Sección}\\label{sección}\n\nTexto.\n';
const FIXTURE_MD = '---\ntitle: "Test Document"\nlanguage: es-MX\n---\n\nTexto.\n';

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
  versionCalls: number;
  pandocCalls: { to?: string; outputPath?: string }[];
}

const world: PipelineWorld = { dir: '', calls: [], versionCalls: 0, pandocCalls: [] };

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
  world.versionCalls = 0;
  world.pandocCalls = [];
  spyOn(pandocRunner, 'getPandocVersion').mockImplementation(async () => {
    world.versionCalls += 1;
    return 'pandoc 3.10.2';
  });
  spyOn(pandocRunner, 'execPandoc').mockImplementation(async (options) => {
    world.pandocCalls.push({ to: options.to, outputPath: options.outputPath });
    return options.to === 'latex' ? FIXTURE_LATEX : FIXTURE_MD;
  });
});

When('compilo el proyecto con un reporter que cuenta eventos', async () => {
  process.exitCode = 0;
  await build(world.dir, {}, fakeReporter(world.calls));
});

function methods(): string[] {
  return world.calls.map((c) => c.method);
}

Then('el build termina con éxito y sin fase de fallo', () => {
  if (process.exitCode !== 0) throw new Error(`el build salió con código ${process.exitCode}`);
  if (methods().includes('fail')) throw new Error('el reporter recibió una fase de fallo');
  for (const expected of ['setFormats', 'planPhases', 'finish']) {
    if (!methods().includes(expected)) throw new Error(`el reporter nunca recibió ${expected}`);
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
  if (world.versionCalls !== 1) throw new Error(`pandoc se consultó ${world.versionCalls} veces y debía una`);
});

Then('pandoc convierte exactamente a LaTeX y a EPUB', () => {
  const targets = world.pandocCalls.map((c) => c.to).sort();
  const expected = ['epub3', 'latex'];
  if (JSON.stringify(targets) !== JSON.stringify(expected)) {
    throw new Error(`esperaba convertir a ${expected.join(' y ')} y se convirtió a ${JSON.stringify(targets)}`);
  }
});

Then('el EPUB sale nombrado con el slug del documento', () => {
  const epub = world.pandocCalls.find((c) => c.to === 'epub3');
  if (epub === undefined) throw new Error('no hubo invocación a epub3');
  if (!(epub.outputPath ?? '').includes('test-document.epub')) {
    throw new Error(`el EPUB salió como ${epub.outputPath}`);
  }
});

Then('dist tiene el .tex y el .md pero no el .epub', async () => {
  const entries = await readdir(join(world.dir, 'dist', 'files'), { recursive: true });
  const files = entries.map(String).filter((f) => f.startsWith('test-document'));
  // El .tex y el .md los escribe nuestro código; el EPUB no existe porque su
  // invocación fue espía y no produjo nada (#2436: el .md ya no pasa por pandoc).
  for (const expected of ['test-document.tex', 'test-document.md']) {
    if (!files.includes(expected)) throw new Error(`falta ${expected} en dist. Hay: ${JSON.stringify(files)}`);
  }
  if (files.includes('test-document.epub')) throw new Error('el EPUB no debía existir: su invocación fue espía');
});

Then('el estado del proyecto queda completado', async () => {
  const raw = await readFile(join(world.dir, '.iteraciones', 'state.json'), 'utf8');
  const state = JSON.parse(raw) as { completed?: boolean };
  // Escritura única del cierre (#2025).
  if (state.completed !== true) throw new Error(`esperaba completed=true y fue ${String(state.completed)}`);
});
