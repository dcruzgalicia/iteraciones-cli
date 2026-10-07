import { statSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { computeBibHash, resolveBibOptions } from '../../builder/state-bib.js';
import { computeFiltersHash } from '../../builder/state-hash.js';
import { DEFAULT_SITE_CONFIG } from '../../config/site-config.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

const config = { ...DEFAULT_SITE_CONFIG, bibliography: 'refs.bib' };

Given('un proyecto con bibliografía y un CSL propio', () => {
  escribirEnProyecto('refs.bib', '@book{a, title={T}, author={A}, year={2020}}\n');
  escribirEnProyecto('custom.csl', '<style/>\n');
});

When('calculo el hash de los filtros', async () => {
  const r = await computeFiltersHash(world.root, DEFAULT_SITE_CONFIG);
  world.hashFiltrosObjeto = r;
  world.hashFiltros = r.hash;
});

When('calculo el hash de los filtros con pandoc {string}', async (version: string) => {
  const r = await computeFiltersHash(world.root, DEFAULT_SITE_CONFIG, undefined, undefined, version);
  world.hashFiltrosObjeto = r;
  world.hashFiltros = r.hash;
});

Then('el hash de los filtros es el mismo de antes', () => {
  const h = (world.hashFiltrosObjeto as { hash: string }).hash;
  const antes = world.hashFiltrosPrevio as string | undefined;
  if (antes !== undefined && h !== antes) {
    throw new Error(`el hash cambió entre dos llamadas idénticas: ${antes} → ${h}`);
  }
});

Given('anoto el hash de los filtros', () => {
  world.hashFiltrosPrevio = (world.hashFiltrosObjeto as { hash: string }).hash;
});

Then('el hash de los filtros es distinto del anterior', () => {
  const h = (world.hashFiltrosObjeto as { hash: string }).hash;
  const antes = world.hashFiltrosPrevio as string;
  if (h === antes) throw new Error(`el hash sigue siendo ${h} y debería haber cambiado`);
});

Then('la caché del hash de los filtros no está vacía', () => {
  const cache = (world.hashFiltrosObjeto as { cache: Record<string, unknown> }).cache;
  if (Object.keys(cache).length === 0) {
    throw new Error('la caché de archivos quedó vacía: la segunda llamada va a hashear todo');
  }
});

When('calculo el hash de la bibliografía sin CSL', async () => {
  world.hashBibPrevio = (world.hashBibObjeto as { hash: string } | undefined)?.hash;
  const r = await computeBibHash(await resolveBibOptions(world.root, config as never));
  world.hashBibObjeto = r;
  world.hashBib = r.hash;
});

When('calculo el hash de la bibliografía con CSL', async () => {
  world.hashBibPrevio = (world.hashBibObjeto as { hash: string } | undefined)?.hash;
  const r = await computeBibHash(await resolveBibOptions(world.root, { ...config, csl: 'custom.csl' } as never));
  world.hashBibObjeto = r;
  world.hashBib = r.hash;
});

Given('anoto el hash de la bibliografía', () => {
  world.hashBibPrevio = (world.hashBibObjeto as { hash: string }).hash;
});

Then('el hash de la bibliografía es el mismo de antes', () => {
  const h = (world.hashBibObjeto as { hash: string }).hash;
  const antes = world.hashBibPrevio as string;
  if (h !== antes) throw new Error(`el hash cambió entre dos llamadas idénticas: ${antes} → ${h}`);
});

Then('el hash de la bibliografía es distinto del anterior', () => {
  const h = (world.hashBibObjeto as { hash: string }).hash;
  const antes = world.hashBibPrevio as string;
  if (h === antes) throw new Error(`el hash sigue siendo ${h} y debería haber cambiado`);
});

Given('un proyecto de prueba con un documento', () => {
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  html:\n    generate: true\n');
  escribirEnProyecto('test-document.md', '---\ntitle: Documento\n---\n\nContenido.\n');
});

When('el orquestador construye el proyecto', async () => {
  process.exitCode = 0;
  await build(world.root);
});

Then('el estado tiene la fecha del build anterior', () => {
  const ruta = join(world.root, '.iteraciones', 'state.json');
  world.mtimeEstado = statSync(ruta).mtimeMs;
});

When('el orquestador construye el proyecto otra vez', async () => {
  process.exitCode = 0;
  await build(world.root);
});

Then('el estado no se ha vuelto a escribir', () => {
  const ruta = join(world.root, '.iteraciones', 'state.json');
  const ahora = statSync(ruta).mtimeMs;
  if (ahora !== world.mtimeEstado) {
    throw new Error(`state.json se reescribió (${world.mtimeEstado} → ${ahora}): un build sin trabajo no debe tocarlo`);
  }
});
