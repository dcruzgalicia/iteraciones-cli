import { Given, Then, When } from '@cucumber/cucumber';
import { parse as parseYaml } from 'yaml';
import { discover, resolveDiscoverSlugs } from '../../builder/discover.js';
import { postProcessCollections } from '../../builder/orchestrator.js';
import { validateFrontmatterFields } from '../../builder/project-validator.js';
import { loadStateFile, persistCompletedState } from '../../builder/state-serialize.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — los créditos de una colección.
 *
 * Una colección no tiene autor propio: lo tiene la unión de los autores de sus
 * miembros. Esa unión es el `aggregatedCreator`, y va ordenada alfabéticamente
 * porque el orden de `files[]` no significa nada para el lector.
 *
 * ## `collectionCreator` es el crédito editorial, no el autor
 *
 * Hay dos preguntas distintas: *quién escribió* (los miembros, agregados) y
 * *quién edita* (una casa editorial). El `slug` usa el segundo y la firma del
 * PDF el primero, porque el nombre del archivo lo elige la editora y la
 * firma acredita a quienes escribieron.
 *
 * ## Sin autor se pone "Anónima", no se deja vacío
 *
 * Un documento sin autor tiene que aparecer en la portada igual que los
 * demás. "Anónima" es lo que ve el lector; un hueco en la lista de autores se
 * lee como un bug.
 */

/** Un proyecto temporal con los documentos que el escenario declare. */
Given('que el proyecto tiene:', (documentos: string) => {
  // Una tabla de `Ejemplos` es de una línea por celda, así que el `\\n` del
  // JSON llega como salto real y rompe las cadenas. Se vuelve a escapar antes
  // de parsear: el JSON del feature lo escribe quien lee el test, no quien
  // lo ejecuta.
  const tablas = JSON.parse(documentos.replace(/\n/g, '\\n')) as Record<string, string>;
  world.documentosProyecto = tablas;
  for (const [nombre, contenido] of Object.entries(tablas)) {
    escribirEnProyecto(nombre, contenido);
  }
});

When('descubro y post-proceso el proyecto', async () => {
  const resultado = await discover(world.root, { prevState: await loadStateFile(world.root) });
  resolveDiscoverSlugs(resultado.discoveryIndex, resultado.slugComputer);
  await postProcessCollections(resultado.discoveryIndex, world.root);
  await persistCompletedState(world.root, resultado.pendingState);
  world.indice = resultado.discoveryIndex;
});

/** La entrada del índice, que es donde vive el crédito ya agregado. */
function entrada(ruta: string): Record<string, unknown> {
  const e = (world.indice as Map<string, Record<string, unknown>> | undefined)?.get(ruta);
  if (!e) throw new Error(`el índice no tiene ${ruta}`);
  return e;
}

Then('el crédito agregado de {string} es {string}', (ruta: string, autores: string) => {
  const leidos = ((entrada(ruta).aggregatedCreator as string[]) ?? []).join(', ');
  if (leidos !== autores) {
    throw new Error(`el crédito es ${JSON.stringify(leidos)} y debería ser ${JSON.stringify(autores)}`);
  }
});

Then('el slug de la colección {string} es {string}', (ruta: string, slug: string) => {
  const leido = String(entrada(ruta).slug ?? '');
  if (leido !== slug) throw new Error(`el slug es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(slug)}`);
});

Then('el collectionCreator de {string} es {string}', (ruta: string, valor: string) => {
  const leido = String((entrada(ruta).fm as Record<string, unknown>)?.collectionCreator ?? '');
  if (leido !== valor) {
    throw new Error(`el collectionCreator es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(valor)}`);
  }
});

Then('el collectionCreator de {string} no está', (ruta: string) => {
  const fm = (entrada(ruta).fm as Record<string, unknown>) ?? {};
  if (fm.collectionCreator !== undefined) {
    throw new Error(`el collectionCreator es ${JSON.stringify(fm.collectionCreator)} y no debía existir`);
  }
});

/**
 * El build completo, no sólo el descubrimiento: el error de #2446 aparece al
 * construir, y es un `BuildError` con el fix en el mensaje.
 */
When('construyo el proyecto entero', async () => {
  try {
    const resultado = await discover(world.root, {
      prevState: await loadStateFile(world.root),
    });
    resolveDiscoverSlugs(resultado.discoveryIndex, resultado.slugComputer);
    await postProcessCollections(resultado.discoveryIndex, world.root);
    await persistCompletedState(world.root, resultado.pendingState);
    world.indice = resultado.discoveryIndex;
    world.errorConstruccion = '';
  } catch (e) {
    world.errorConstruccion = e instanceof Error ? e.message : String(e);
  }
});

Then('la construcción falla diciendo {string}', (texto: string) => {
  if (world.errorConstruccion === '') throw new Error('el build no falló y debía');
  if (!world.errorConstruccion.includes(texto)) {
    throw new Error(`el error no dice ${JSON.stringify(texto)}. Dice:\n${world.errorConstruccion}`);
  }
});

/** `validateFrontmatterFields` en crudo: qué campos son conocidos. */
When('valido el frontmatter crudo:', (fm: string) => {
  world.issuesFrontmatter = validateFrontmatterFields(parseYaml(fm));
});

Then('ningún error menciona {string}', (campo: string) => {
  const errores = (world.issuesFrontmatter as { severity: string; message: string }[]).filter((i) => i.severity === 'error');
  if (errores.length > 0) throw new Error(`hay ${errores.length} errores: ${errores.map((e) => e.message).join(' | ')}`);
  const menciona = (world.issuesFrontmatter as { message: string }[]).filter((i) => i.message.includes(campo));
  if (menciona.length > 0) throw new Error(`algún aviso menciona ${campo}: ${menciona[0]?.message}`);
});
