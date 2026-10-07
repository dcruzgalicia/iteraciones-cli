import { spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { discover } from '../../builder/discover.js';
import { postProcessCollections } from '../../builder/orchestrator.js';
import { readCollectionEntries } from '../../builder/pipeline-formats.js';
import { loadStateFile } from '../../builder/state-serialize.js';
import { runMerge } from '../../cli/merge.js';
import { validateProject } from '../../cli/validate.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — cómo se resuelven los `files[]` de una collection (#2443).
 *
 * ## Relativo al `.md` primero, raíz después
 *
 * Un `files: [../prólogo.md]` en `sub/coleccion.md` significa `prólogo.md` en la
 * raíz: la ruta es relativa a la collection. Pero un `files: [sub/miembro.md]`
 * escrito así, en una collection dentro de `sub/`, significaría
 * `sub/sub/miembro.md` — que no existe. Así que se prueban las dos y gana la que
 * está. Es el fallback que hace que los proyectos con la convención antigua
 * sigan funcionando sin editar nada.
 *
 * ## El error lista las rutas que se probaron
 *
 * Sin eso el autor ve `no encontrado "../02-prólogo.md"` y no sabe si debería
 * escribirlo relativo a la collection o a la raíz. Con las dos rutas en el
 * mensaje, la respuesta está en el error.
 *
 * ## `postProcess` es tolerante, la lectura no
 *
 * Normalizar no puede lanzar: el índice se construye para toda la colección, y
 * que un miembro falte no invalida a los demás. Quien lanza es la lectura, que
 * es donde de verdad se necesita el archivo.
 */

const CONFIG = [
  'language: es-MX',
  'format:',
  '  html:',
  '    site:',
  '      title: T',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

function indice() {
  return world.indice as Map<string, { files?: string[]; fm?: { files?: string[] } }>;
}

Given('una colección en subdirectorios con los dos estilos de rutas', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${CONFIG}\n`);
  escribirEnProyecto('raiz.md', '---\ntitle: Raíz\n---\n\nEn la raíz.\n');
  escribirEnProyecto('sub/miembro-local.md', '---\ntitle: Local\n---\n\nLocal.\n');
  escribirEnProyecto('sub/miembro2.md', '---\ntitle: Miembro 2\n---\n\nRoot-style.\n');
  escribirEnProyecto('sub/coleccion.md', '---\ntype: collection\nfiles:\n  - ../raiz.md\n  - miembro-local.md\n---\n');
  escribirEnProyecto('sub/c2.md', '---\ntype: collection\nfiles:\n  - sub/miembro2.md\n---\n');
});

Given('una colección que apunta a un archivo que no existe', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${CONFIG}\n`);
  escribirEnProyecto('doc.md', '---\ntitle: Doc\n---\n\nContenido.\n');
  escribirEnProyecto('test/collection.md', '---\ntype: collection\nfiles:\n  - ../02-prologo.md\n---\n');
});

Given('una colección en un subdirectorio que apunta a la raíz', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${CONFIG}\n`);
  escribirEnProyecto('sub/c.md', '---\ntitle: Antología\ntype: collection\nfiles:\n  - sub/m.md\n---\n\nIntro.\n');
  escribirEnProyecto('sub/m.md', '---\ntitle: Miembro\ncreator: Autora X\n---\n\nContenido fusionable.\n');
});

When('descubro y normalizo las rutas de las colecciones', async () => {
  const resultado = await discover(world.root, {
    prevState: await loadStateFile(world.root),
  });
  await postProcessCollections(resultado.discoveryIndex, world.root);
  world.indice = resultado.discoveryIndex;
});

When('intento leer los miembros de {string} de {string}', async (archivos: string, coleccion: string) => {
  try {
    await readCollectionEntries(
      archivos
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      coleccion,
      [world.root, join(world.root, 'test')],
    );
    world.errorLectura = '';
  } catch (e) {
    world.errorLectura = e instanceof Error ? e.message : String(e);
  }
});

When('valido el proyecto buscando archivos faltantes', async () => {
  const espia = spyOn(process.stderr, 'write');
  process.exitCode = 0;
  try {
    await validateProject(world.root);
    world.codigoValidate = process.exitCode ?? 0;
    world.stderrValidate = espia.mock.calls.map((c) => String(c[0])).join('');
  } finally {
    espia.mockRestore();
    process.exitCode = 0;
  }
});

When('aparecen los archivos que faltaban', () => {
  escribirEnProyecto('02-prologo.md', '---\ntitle: Prólogo\n---\n\nPrólogo.\n');
});

When('fusiono {string} en markdown', async (coleccion: string) => {
  process.exitCode = 0;
  try {
    await runMerge(world.root, coleccion, { format: 'markdown', output: 'out.md' });
    world.codigoMerge = process.exitCode ?? 0;
  } finally {
    process.exitCode = 0;
  }
  world.textoMerge = readFileSync(join(world.root, 'out.md'), 'utf8');
});

// ── Las rutas ──────────────────────────────────────────────────────────────

Then('los files de {string} son {string}', (coleccion: string, esperados: string) => {
  const leidos = (indice().get(coleccion)?.files ?? []).join(', ');
  const queried = esperados
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ');
  if (leidos !== queried) {
    throw new Error(`los files de ${coleccion} son ${JSON.stringify(leidos)} y debían ser ${JSON.stringify(queried)}`);
  }
});

Then('el frontmatter de {string} también queda normalizado', (coleccion: string) => {
  const files = indice().get(coleccion)?.files ?? [];
  const fm = indice().get(coleccion)?.fm?.files ?? [];
  if (files.join(',') !== fm.join(',')) {
    throw new Error(`files dice ${JSON.stringify(files)} y el frontmatter ${JSON.stringify(fm)}`);
  }
});

/** El error tiene que decir dónde se buscó, o el autor no puede corregirlo. */
Then('la lectura falla con un BuildError que lista:', (lista: string) => {
  const mensaje = String(world.errorLectura);
  if (mensaje === '') throw new Error('la lectura no falló y debía');
  const faltan = lista
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !mensaje.includes(t));
  if (faltan.length > 0) throw new Error(`al error le faltan ${JSON.stringify(faltan)}:\n${mensaje}`);
});

Then('el mensaje dice las dos rutas absolutas que se probaron', () => {
  const mensaje = String(world.errorLectura);
  const raiz = world.root;
  const desdeLaColeccion = join(raiz, '..', '02-prologo.md');
  const desdeLaRaiz = join(raiz, '02-prologo.md');
  const faltan = [desdeLaColeccion, desdeLaRaiz].filter((r) => !mensaje.includes(r));
  if (faltan.length > 0) {
    throw new Error(`el mensaje no menciona ${JSON.stringify(faltan)}:\n${mensaje}`);
  }
});

Then('validate sale con código {int} tras comprobar los archivos', (codigo: number) => {
  if (world.codigoValidate !== codigo) {
    throw new Error(`validate salió con ${world.codigoValidate} y el escenario dice ${codigo}`);
  }
});

Then('validate dice:', (lista: string) => {
  const salida = String(world.stderrValidate);
  const faltan = lista
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !salida.includes(t));
  if (faltan.length > 0) throw new Error(`validate no dice ${JSON.stringify(faltan)}:\n${salida}`);
});

Then('merge sale con código {int}', (codigo: number) => {
  if (world.codigoMerge !== codigo) {
    throw new Error(`merge salió con ${world.codigoMerge} y el escenario dice ${codigo}`);
  }
});

Then('el markdown fusionado contiene:', (lista: string) => {
  const salida = String(world.textoMerge);
  const faltan = lista
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !salida.includes(t));
  if (faltan.length > 0) throw new Error(`al markdown le faltan ${JSON.stringify(faltan)}`);
});
