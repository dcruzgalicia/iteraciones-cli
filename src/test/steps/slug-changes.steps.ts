import { spyOn } from 'bun:test';
import { rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { discover, resolveDiscoverSlugs } from '../../builder/discover.js';
import { loadStateFile, persistCompletedState } from '../../builder/state-serialize.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — el cambio de slug por metadatos.
 *
 * ## Por qué hay que acordarse del slug viejo
 *
 * El slug es el nombre del archivo en `dist`. Cuando cambia, el archivo viejo
 * se queda ahí para siempre: `dist/prueba-por-juan-perez.pdf` conviviendo con
 * `dist/prueba.pdf`. Esta lista alimenta la limpieza de los dos —la salida y la
 * caché— y sin ella `dist` engorda en cada renombre.
 *
 * ## La comparación es de slug, no de metadatos
 *
 * Dos casos lo hacen importante: quitar el autor deja `prueba-por-juan-perez` y
 * `prueba`, donde el nuevo **es prefijo del viejo**; y lo mismo al acortar el
 * título. Una comparación mal escrita deja el archivo viejo sin borrar justo en
 * los casos que más duelen.
 *
 * ## Un cambio que no toca los metadatos no genera slug nuevo
 *
 * Editar el cuerpo cambia su contenido y su `dist`, pero el slug es el mismo: no
 * hay nada que limpiar. Registrar un cambio aquí borraría un archivo que sigue
 * vivo.
 *
 * ## El sufijo `-dN` no es un nombre provisional
 *
 * Es lo que evita que dos documentos con el mismo título se pisen. Que el
 * duplicado desaparezca NO es un renombre: `prueba-d1` sigue siendo su nombre.
 */

/** Un "build" completo: discover + slugs + cierre único (#2025). */
async function buildStep(): Promise<void> {
  const resultado = await discover(world.root, {
    prevState: await loadStateFile(world.root),
  });
  const { slugChangedEntries } = resolveDiscoverSlugs(resultado.discoveryIndex, resultado.slugComputer);
  await persistCompletedState(world.root, resultado.pendingState);
  world.cambiados = resultado.changedPaths;
  world.slugsCambiados = slugChangedEntries;
  world.indice = resultado.discoveryIndex;
}

function frontmatterDe(titulo: string, autor: string): string {
  return autor === '' ? `title: ${titulo}` : `title: ${titulo}\ncreator: ${autor}`;
}

Given('un documento que se titula {string} con {string}', (titulo: string, autor: string) => {
  escribirEnProyecto('doc.md', `---\n${frontmatterDe(titulo, autor)}\n---\n\nContenido`);
});

Given('el documento pasa a llamarse {string} con {string}', (titulo: string, autor: string) => {
  escribirEnProyecto('doc.md', `---\n${frontmatterDe(titulo, autor)}\n---\n\nContenido`);
});

/**
 * Fuerza un mtime futuro: dos escrituras en el mismo milisegundo tienen el
 * mismo tamaño y el discovery puede considerarlas idénticas.
 */
Given('el documento queda con fecha de modificación futura', () => {
  const futuro = new Date(Date.now() + 60_000);
  utimesSync(join(world.root, 'doc.md'), futuro, futuro);
});

/** El cuerpo cambia, los metadatos no. */
When('el documento cambia sólo el contenido con autor', () => {
  escribirEnProyecto('doc.md', '---\ntitle: Prueba\ncreator: Juan Pérez\n---\n\nOtro contenido');
});

When('el documento cambia sólo el contenido sin autor', () => {
  escribirEnProyecto('doc.md', '---\ntitle: Prueba\n---\n\nContenido modificado');
});

/** Un segundo archivo con el mismo título entra en el grupo de duplicados. */
Given('aparece otro documento con el mismo título {string}', (titulo: string) => {
  escribirEnProyecto('otro.md', `---\ntitle: ${titulo}\n---\n\nOtro contenido`);
});

Given('elimino el documento duplicado', () => {
  rmSync(join(world.root, 'otro.md'), { force: true });
});

/** Un `slug:` explícito manda sobre el derivado del título (#2012). */
Given('el documento tiene el slug manual {string}', (slug: string) => {
  escribirEnProyecto('doc.md', `---\ntitle: Test Document\nslug: ${slug}\n---\n\nContenido`);
});

Given('el documento cambia su slug manual a {string}', (slug: string) => {
  escribirEnProyecto('doc.md', `---\ntitle: Test Document\nslug: ${slug}\n---\n\nContenido`);
});

When('hago el build', async () => {
  await buildStep();
});

/** Sin estado previo se resuelve todo desde cero. */
When('hago el build completo sin estado previo', async () => {
  const resultado = await discover(world.root, { full: true, prevState: null });
  const { slugChangedEntries } = resolveDiscoverSlugs(resultado.discoveryIndex, resultado.slugComputer);
  await persistCompletedState(world.root, resultado.pendingState);
  world.cambiados = resultado.changedPaths;
  world.slugsCambiados = slugChangedEntries;
  world.indice = resultado.discoveryIndex;
});

/** El aviso de diacríticos va por stderr (#2090). */
When('hago el build mirando stderr', async () => {
  const espia = spyOn(process.stderr, 'write');
  try {
    await buildStep();
  } finally {
    world.stderrSlug = espia.mock.calls.map((c) => String(c[0])).join('');
    espia.mockRestore();
  }
});

Then('el slug del documento {string} es {string}', (archivo: string, slug: string) => {
  const entrada = (world.indice as Map<string, { slug?: string }>).get(archivo);
  if (entrada?.slug !== slug) {
    throw new Error(`el slug de ${archivo} es ${JSON.stringify(entrada?.slug)} y debería ser ${slug}`);
  }
});

Then('el slug anterior de {string} fue {string}', (archivo: string, anterior: string) => {
  const leido = (world.slugsCambiados as Map<string, string>).get(archivo);
  if (leido !== anterior) {
    throw new Error(`el slug anterior de ${archivo} es ${JSON.stringify(leido)} y debería ser ${anterior}`);
  }
});

Then('nadie cambió de slug', () => {
  const mapa = world.slugsCambiados as Map<string, string>;
  if (mapa.size !== 0) {
    throw new Error(`cambiaron ${mapa.size} slugs: ${JSON.stringify([...mapa])}`);
  }
});

Then('{string} sí cambió', (archivo: string) => {
  if (!(world.cambiados as Set<string>).has(archivo)) throw new Error(`${archivo} no salió como cambiado`);
});

Then('{string} NO cambió', (archivo: string) => {
  if ((world.cambiados as Set<string>).has(archivo)) throw new Error(`${archivo} salió como cambiado y no debía`);
});

Then('stderr advierte que el slug altera palabras del título', () => {
  const salida = String(world.stderrSlug);
  if (!salida.includes('altera palabras del título')) throw new Error(`stderr no advierte:\n${salida}`);
});

Then('stderr propone el slug {string}', (slug: string) => {
  const salida = String(world.stderrSlug);
  if (!salida.includes(slug)) throw new Error(`stderr no propone ${slug}:\n${salida}`);
});

Then('stderr no advierte por diacríticos', () => {
  const salida = String(world.stderrSlug);
  if (salida.includes('altera palabras del título')) {
    throw new Error(`stderr avisa cuando no debe:\n${salida}`);
  }
});
