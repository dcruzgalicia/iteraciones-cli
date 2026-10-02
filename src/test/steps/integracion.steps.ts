import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { initTestProject } from '../../__tests__/helpers.js';
import { build } from '../../builder/orchestrator.js';
import { runNew } from '../../cli/dispatcher.js';
import { initProject } from '../../cli/init.js';
import { validateProject } from '../../cli/validate.js';

/**
 * #2546 (onda 2) — `integration`: `init`, `build` y `validate` de punta a punta.
 *
 * ## Por qué el estado se guarda y compara, en vez de un `expect`
 *
 * El caso de #2168 es el único que mira el *estado* entre dos builds: el
 * `state.json` del build completo tiene que sobrevivir intacto a un build que
 * falla. Eso no cabe en un `Then` de igualdad sin referenciar el mundo dos
 * veces, así que el `When` guarda la referencia y el `Then` compara.
 *
 * ## El `exitCode` de validate
 *
 * `validateProject` no lanza: fija `process.exitCode`. El original lo guardaba y
 * lo restauraba a mano para no contaminar el resto de la corrida — que es
 * exactamente el problema del world object. Aquí se guarda una vez y lo restaura
 * el `After`, que corre pase lo que pase.
 */

interface IntWorld {
  dir: string;
  /** Configuración del proyecto bueno, para volver a ella tras romperla (#2168). */
  configBefore: string;
  /** `state.json` del último build completo: debe sobrevivir a un build fallido. */
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

// ── Given ────────────────────────────────────────────────────────────────────

Given('un directorio vacío', async () => {
  await mkdir(world.dir, { recursive: true });
});

Given('un proyecto con el documento inicial de prueba', async () => {
  await initTestProject(world.dir);
});

Given('un proyecto con un documento de frontmatter sin cerrar', async () => {
  await initTestProject(world.dir);
  await writeFile(join(world.dir, 'bad.md'), '---\ntitle: "sin cerrar\n---\n\nContenido.\n', 'utf8');
});

// ── When ─────────────────────────────────────────────────────────────────────

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
  // Se guarda DESPUÉS del build bueno: es la referencia que el build fallido no
  // debe tocar. El original lo leía con un `expect` de longitud aquí mismo.
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
  // Error de config previo al discovery: el build falla entero.
  await writeFile(join(world.dir, 'iteraciones.config.yaml'), `${world.configBefore}\nbibliography: refs/no-existe.bib\n`);
});

When('compilo otra vez', async () => {
  // El build con la bibliografía rota tiene que fallar, no dejar un estado a medias.
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
  } catch {
    // validate no lanza por errores de frontmatter: fija exitCode. El catch sólo
    // cubre un fallo inesperado, que sí sería un error del test.
  }
  world.validateExitCode = process.exitCode;
  // El `After` lo restaura igual, pero dejarlo en 0 evita que un fallo posterior
  // lo reporte como error de cucumber.
  process.exitCode = 0;
});

// ── Then ─────────────────────────────────────────────────────────────────────

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
