import { Given, Then, When } from '@cucumber/cucumber';
import { parse as parseYaml } from 'yaml';
import { discover, resolveDiscoverSlugs } from '../../builder/discover.js';
import { postProcessCollections } from '../../builder/orchestrator.js';
import { validateFrontmatterFields } from '../../builder/project-validator.js';
import { loadStateFile, persistCompletedState } from '../../builder/state-serialize.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

Given('que el proyecto tiene:', (documentos: string) => {
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

When('valido el frontmatter crudo:', (fm: string) => {
  world.issuesFrontmatter = validateFrontmatterFields(parseYaml(fm));
});

Then('ningún error menciona {string}', (campo: string) => {
  const errores = (world.issuesFrontmatter as { severity: string; message: string }[]).filter((i) => i.severity === 'error');
  if (errores.length > 0) throw new Error(`hay ${errores.length} errores: ${errores.map((e) => e.message).join(' | ')}`);
  const menciona = (world.issuesFrontmatter as { message: string }[]).filter((i) => i.message.includes(campo));
  if (menciona.length > 0) throw new Error(`algún aviso menciona ${campo}: ${menciona[0]?.message}`);
});
