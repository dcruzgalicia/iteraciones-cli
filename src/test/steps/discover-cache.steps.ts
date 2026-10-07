import { spyOn } from 'bun:test';
import { readFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { discover } from '../../builder/discover.js';
import { loadStateFile, persistCompletedState } from '../../builder/state-serialize.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — la caché content-addressed del descubrimiento.
 *
 * ## Tres preguntas, en este orden, y por qué
 *
 * Un archivo puede haber cambiado sin que el build lo note, y ese es el fallo
 * caro: el autor edita, compila y sale un PDF viejo sin ningún error. Así que la
 * caché escalona —cada pregunta sale más cara que la anterior—:
 *
 * 1. **¿mismo mtime y mismo tamaño?** → no se lee el archivo. Es el caso normal
 *    de un rebuild y por eso tiene que ser sólo un `stat`.
 * 2. **¿tamaño distinto?** → cambió, sin necesidad de hashear.
 * 3. **mtime distinto con tamaño igual** → hay que leer y hashear. Y el hash
 *    decide: si es igual, era un `touch` o un `git clone`, y el archivo **no**
 *    se reprocesa.
 *
 * ## El mtime del `touch` se persiste (#2188)
 *
 * Si tras un `touch` no se guardara el mtime nuevo, el build siguiente volvería
 * a hashear el mismo archivo otra vez. Y a la siguiente. El `touch` se paga una
 * vez, no en cada build hasta que el archivo vuelva a tocarse.
 *
 * ## Un `git clone` reescribe los mtimes de todo
 *
 * Mismos contenidos, mtimes nuevos. Si el build se fiara del mtime, el primer
 * build después de cada clone reprocesaría el proyecto entero. El hash es lo que
 * salva ese caso, por eso está.
 */

interface Estado {
  entries: Record<string, { mtime: number; hash: string }>;
}

function estado(): Estado {
  const ruta = join(world.root, '.iteraciones', 'state.json');
  return JSON.parse(readFileSync(ruta, 'utf8')) as Estado;
}

/** Un "build" completo: discover + cierre único (#2025). */
async function buildStep(): Promise<void> {
  const resultado = await discover(world.root, {
    prevState: await loadStateFile(world.root),
  });
  await persistCompletedState(world.root, resultado.pendingState);
  world.cambiados = resultado.changedPaths;
  world.borrados = resultado.deletedEntries as unknown as Set<string>;
}

const doc = (): string => '---\ntitle: Prueba\n---\n\nContenido';

Given('un proyecto con un documento', () => {
  escribirEnProyecto('doc.md', doc());
});

/** Mismo largo que "Contenido", distinto contenido: sólo el hash lo ve. */
Given('el documento cambia por uno del mismo tamaño', () => {
  escribirEnProyecto('doc.md', '---\ntitle: Prueba\n---\n\nCambiado');
});

Given('el documento crece', () => {
  escribirEnProyecto('doc.md', '---\ntitle: Prueba\n---\n\nContenido mucho más largo');
});

Given('aparece un documento nuevo', () => {
  escribirEnProyecto('nuevo.md', '---\ntitle: Nuevo\n---\n\nTexto');
});

Given('se borra el documento', () => {
  rmSync(join(world.root, 'doc.md'));
});

Given('aparece un documento sin título en el frontmatter', () => {
  escribirEnProyecto('sin-titulo.md', '# Solo contenido, sin frontmatter');
});

/** El `touch` no cambia el contenido: sólo la fecha. */
Given('el documento se toca {int} segundos en el futuro', (segundos: number) => {
  const mtime = estado().entries['doc.md']?.mtime ?? Date.now();
  const futuro = mtime + segundos * 1000;
  utimesSync(join(world.root, 'doc.md'), new Date(futuro), new Date(futuro));
});

Given('el documento se reescribe con el mismo contenido {int} segundos después', (segundos: number) => {
  const contenido = readFileSync(join(world.root, 'doc.md'), 'utf8');
  escribirEnProyecto('doc.md', contenido);
  const mtime = estado().entries['doc.md']?.mtime ?? Date.now();
  const futuro = mtime + segundos * 1000;
  utimesSync(join(world.root, 'doc.md'), new Date(futuro), new Date(futuro));
});

Given('anoto el estado persistido', () => {
  world.estadoAntes = { ...estado().entries['doc.md'] } as unknown as Record<string, unknown>;
});

When('descubro el proyecto', async () => {
  await buildStep();
});

When('descubro el proyecto mirando stderr', async () => {
  const espia = spyOn(process.stderr, 'write');
  try {
    await buildStep();
  } finally {
    world.stderrCache = espia.mock.calls.map((c) => String(c[0])).join('');
    espia.mockRestore();
  }
});

Then('los documentos que cambiaron son {string}', (esperados: string) => {
  const leidos = [...(world.cambiados as Set<string>)].sort().join(', ');
  const queried = esperados.trim();
  if (leidos !== queried) {
    throw new Error(`cambiaron ${JSON.stringify(leidos)} y debían cambiar ${JSON.stringify(queried)}`);
  }
});

Then('nada cambió', () => {
  const cambiados = [...(world.cambiados as Set<string>)];
  if (cambiados.length > 0) throw new Error(`cambiaron ${JSON.stringify(cambiados)} y no debía cambiar nada`);
});

Then('{string} está en los borrados', (archivo: string) => {
  if (!(world.borrados as Set<string>).has(archivo)) {
    throw new Error(`${archivo} no entró en los borrados`);
  }
});

/** El mtime persistido tras el `touch`: la aserción de #2188. */
Then('el mtime persistido es el del toque', () => {
  const antes = world.estadoAntes as { mtime: number; hash: string };
  const ahora = estado().entries['doc.md'];
  if (!ahora) throw new Error('doc.md no está en el estado persistido');
  if (ahora.mtime === antes.mtime) {
    throw new Error(`el mtime sigue siendo ${ahora.mtime}: el build siguiente va a re-hashear el archivo`);
  }
  if (ahora.hash !== antes.hash) throw new Error('el hash cambió y el contenido es el mismo');
});

Then('el hash persistido NO cambió', () => {
  const antes = world.estadoAntes as { hash: string };
  const ahora = estado().entries['doc.md'];
  if (ahora?.hash !== antes.hash) {
    throw new Error(`el hash pasó de ${antes.hash} a ${ahora?.hash} con el mismo contenido`);
  }
});

Then('stderr dice:', (lista: string) => {
  const salida = String(world.stderrCache);
  const faltan = lista
    .split('\n')
    .map((t) => t.trim().replace(/["']/g, ''))
    .filter(Boolean)
    .filter((t) => !salida.includes(t));
  if (faltan.length > 0) throw new Error(`stderr no dice ${JSON.stringify(faltan)}:\n${salida}`);
});
