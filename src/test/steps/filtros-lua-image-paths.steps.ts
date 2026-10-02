import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { PandocError } from '../../lib/errors.js';
import { execPandoc } from '../../lib/pandoc-runner.js';

/**
 * #2545 (onda 1) — `semantic/ast/04-image-paths` (#2460).
 *
 * ## Por qué el mapa viaja por un fichero
 *
 * `ITERACIONES_PATHS_JSON` y no argv: el mapa crece con el número de imágenes y
 * una lista de rutas en la línea de comandos tiene límites del sistema. El
 * mapa tiene TRES claves por imagen —absoluta, relativa y `./relativa`— porque
 * el AST puede traer cualquiera de las tres según de dónde venga la referencia.
 */

const FILTER = join(import.meta.dir, '../../lib/resources/filters/semantic/ast/04-image-paths.lua');

const DOC = [
  '---',
  'title: Doc',
  'titleImage: imgs/portada.png',
  'lowertitleback: |',
  '  baja con ![](imgs/baja.png)',
  '---',
  '',
  'Cuerpo ![](imgs/cuerpo.png) y <img src="imgs/crudo.png" alt="x">',
  '',
  '![ref][id]',
  '',
  '[id]: imgs/ref.png',
].join('\n');

const NOMBRES = ['cuerpo', 'portada', 'crudo', 'baja', 'ref'];

interface ImageWorld {
  dir: string;
  mapa: string;
  output: string;
  failed: unknown;
}

const world: ImageWorld = { dir: '', mapa: '', output: '', failed: undefined };

function destino(nombre: string): string {
  return join(world.dir, 'assets', `doc-${nombre}.jpg`);
}

Before(async () => {
  world.dir = await mkdtemp(join(tmpdir(), 'iteraciones-gherkin-'));
  world.mapa = join(world.dir, 'paths.json');
  const entries: Record<string, string> = {};
  for (const nombre of NOMBRES) {
    entries[`imgs/${nombre}.png`] = destino(nombre);
    entries[`./imgs/${nombre}.png`] = destino(nombre);
    entries[`${world.dir}/imgs/${nombre}.png`] = destino(nombre);
  }
  await writeFile(world.mapa, JSON.stringify(entries));
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

Given('un documento con imágenes en el cuerpo, el frontmatter y una referencia', () => {
  // El documento es fijo en los cinco escenarios; este step sólo declara el
  // sujeto para que el feature se lea sin conocer la constante.
});

Given('el mapa de rutas del preproceso', () => {
  world.failed = undefined;
});

Given('un mapa de rutas que no existe', () => {
  world.failed = undefined;
});

async function run(to: 'latex' | 'html5' | 'json', paths?: string): Promise<string> {
  return execPandoc({
    input: DOC,
    sourcePath: 'test.md',
    to,
    extraArgs: ['--lua-filter', FILTER],
    env: paths === undefined ? {} : { ITERACIONES_PATHS_JSON: paths },
  });
}

When('lo convierto a LaTeX con el filtro de rutas', async () => {
  world.output = await run('latex', world.mapa);
});

When('lo convierto a LaTeX sin el mapa de rutas', async () => {
  world.output = await run('latex');
});

When('lo convierto a HTML con el filtro de rutas', async () => {
  world.output = await run('html5', world.mapa);
});

When('lo convierto a JSON con el filtro de rutas', async () => {
  world.output = await run('json', world.mapa);
});

When('lo convierto a LaTeX con un mapa que no existe', async () => {
  world.failed = undefined;
  try {
    await run('latex', join(world.dir, 'falta.json'));
  } catch (error) {
    world.failed = error;
  }
});

Then('el .tex apunta a las copias de las imágenes', () => {
  for (const nombre of ['cuerpo', 'ref']) {
    if (!world.output.includes(destino(nombre))) {
      throw new Error(`el .tex no apunta a la copia de ${nombre}: ${destino(nombre)}`);
    }
  }
});

Then('el .tex no conserva ninguna ruta original', () => {
  for (const nombre of ['cuerpo', 'ref']) {
    if (world.output.includes(`imgs/${nombre}.png`)) {
      throw new Error(`el .tex conserva la ruta original imgs/${nombre}.png`);
    }
  }
});

Then('el HTML apunta a la copia de la imagen cruda', () => {
  const expected = `<img src="${destino('crudo')}"`;
  if (!world.output.includes(expected)) throw new Error(`el HTML no trae ${expected}`);
});

Then('el HTML no conserva la ruta original', () => {
  if (world.output.includes('imgs/crudo.png')) throw new Error('el HTML conserva la ruta original imgs/crudo.png');
});

Then('el frontmatter apunta a las copias de la portada y del pie', () => {
  const ast = JSON.parse(world.output) as { meta?: Record<string, unknown> };
  const meta = JSON.stringify(ast.meta ?? {});
  for (const nombre of ['portada', 'baja']) {
    if (!meta.includes(destino(nombre))) throw new Error(`el frontmatter no apunta a la copia de ${nombre}`);
  }
});

Then('el .tex conserva las rutas originales', () => {
  if (!world.output.includes('imgs/cuerpo.png')) throw new Error('sin mapa el .tex debe quedarse con la ruta original');
  if (world.output.includes(destino('cuerpo'))) throw new Error('sin mapa el .tex no debe apuntar a ninguna copia');
});

Then('la conversión falla con un error que nombra el filtro', () => {
  if (world.failed === undefined) throw new Error('la conversión no falló y debía');
  if (!(world.failed instanceof PandocError)) throw new Error(`esperaba un PandocError y obtuve ${String(world.failed)}`);
  if (!world.failed.stderr.includes('04-image-paths')) {
    throw new Error(`el stderr no nombra el filtro: ${world.failed.stderr}`);
  }
});
