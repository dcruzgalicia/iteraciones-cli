import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { runNew } from '../../cli/dispatcher.js';
import { initProject } from '../../cli/init.js';
import { validateProject } from '../../cli/validate.js';
import { initTestProject } from '../helpers.js';

interface IntWorld {
  dir: string;

  configBefore: string;

  stateBefore: string;
  htmlMtime: number;
  buildFailed: boolean;
  validateExitCode: number | undefined;
}

const world: IntWorld = { dir: '', configBefore: '', stateBefore: '', htmlMtime: 0, buildFailed: false, validateExitCode: undefined };
const previousExitCode = process.exitCode;

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
});

After(async () => {
  process.exitCode = previousExitCode;
  await rm(world.dir, { recursive: true, force: true });
});

function distPath(...parts: string[]): string {
  return join(world.dir, 'dist', 'files', ...parts);
}

Given('un directorio vacío', async () => {
  await mkdir(world.dir, { recursive: true });
});

Given('un proyecto con el documento inicial de prueba', async () => {
  initTestProject(world.dir);
});

Given('un proyecto con un documento de frontmatter sin cerrar', async () => {
  initTestProject(world.dir);
  await writeFile(join(world.dir, 'bad.md'), '---\ntitle: "sin cerrar\n---\n\nContenido.\n', 'utf8');
});

When('inicializo el proyecto', async () => {
  await initProject(world.dir);
});

When('creo los capítulos uno y dos', async () => {
  await runNew(world.dir, 'capitulo-1.md', { title: 'Capítulo 1' });
  await runNew(world.dir, 'capitulo-2.md', { title: 'Capítulo 2' });
});

When('compilo el proyecto entero desde cero', async () => {
  process.exitCode = 0;
  await build(world.dir, { full: true });

  const statePath = join(world.dir, '.iteraciones', 'state.json');
  if (await Bun.file(statePath).exists()) {
    const previo = await readFile(statePath, 'utf8');
    if (previo.length > 0) world.stateBefore = previo;
  }
});

When('recompilo sin tocar nada', async () => {
  world.htmlMtime = (await stat(distPath('test-document.html'))).mtimeMs;
  await build(world.dir);
});

When('cambio el tema del sitio en la configuración', async () => {
  await writeFile(
    join(world.dir, 'iteraciones.config.yaml'),
    ['language: es-MX', 'format:', '  html:', '    site:', '      title: Test', '      theme: light', '    generate: true'].join('\n'),
  );
});

When('apunto la bibliografía a un archivo que no existe', async () => {
  world.configBefore = await readFile(join(world.dir, 'iteraciones.config.yaml'), 'utf8');

  await writeFile(join(world.dir, 'iteraciones.config.yaml'), `${world.configBefore}\nbibliography: refs/no-existe.bib\n`);
});

When('compilo otra vez', async () => {
  process.exitCode = 0;
  world.buildFailed = false;
  try {
    await build(world.dir, {});
  } catch {
    world.buildFailed = true;
  }
});

When('corrijo la bibliografía y compilo otra vez', async () => {
  await writeFile(join(world.dir, 'iteraciones.config.yaml'), world.configBefore);
  process.exitCode = 0;
  await build(world.dir, {});
});

When('valido el proyecto', async () => {
  process.exitCode = undefined;
  try {
    await validateProject(world.dir);
  } catch {}
  world.validateExitCode = process.exitCode;

  process.exitCode = 0;
});

Then('el proyecto tiene configuración y documento inicial', async () => {
  for (const archivo of ['iteraciones.config.yaml', 'index.md']) {
    if (!(await Bun.file(join(world.dir, archivo)).exists())) throw new Error(`init no creó ${archivo}`);
  }
});

Then('dist tiene al menos un HTML', async () => {
  for await (const _entry of new Bun.Glob('*.html').scan({ cwd: distPath() })) return;
  throw new Error('dist no tiene ningún HTML');
});

Then('el HTML no se reescribe', async () => {
  const despues = (await stat(distPath('test-document.html'))).mtimeMs;
  if (despues !== world.htmlMtime) {
    throw new Error(`el HTML se reescribió sin cambios: mtime ${world.htmlMtime} → ${despues}`);
  }
});

Then('el HTML sigue en dist', async () => {
  if (!(await Bun.file(distPath('test-document.html')).exists())) throw new Error('el HTML desapareció de dist');
});

Then('dist tiene un HTML para el índice y para cada capítulo', async () => {
  for (const nombre of ['index.html', 'capitulo-1.html', 'capitulo-2.html']) {
    if (!(await Bun.file(distPath(nombre)).exists())) throw new Error(`falta ${nombre} en dist`);
  }
});

Then('el build falla', () => {
  if (world.buildFailed !== true) throw new Error('el build con la bibliografía rota tuvo que fallar y no falló');
});

Then('el estado guardado sigue siendo el del build completo', async () => {
  const ahora = await readFile(join(world.dir, '.iteraciones', 'state.json'), 'utf8');
  if (ahora !== world.stateBefore) {
    throw new Error('el state.json cambió con un build fallido: la caché preservada se perdió');
  }
});

Then('dist vuelve a tener sus HTML', async () => {
  const htmls = [...new Bun.Glob('*.html').scanSync({ cwd: distPath() })];
  if (htmls.length === 0) throw new Error('tras corregir la bibliografía dist no volvió a tener HTML');
});

Then('validate sale con código de error', () => {
  if (world.validateExitCode !== 1) {
    throw new Error(`esperaba exitCode 1 de validate y obtuve ${String(world.validateExitCode)}`);
  }
});
