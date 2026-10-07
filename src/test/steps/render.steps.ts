import { spyOn } from 'bun:test';
import { Given, Then, When } from '@cucumber/cucumber';
import { getBuiltinFilterNames, suggestFilterName, validateDisabledFilters } from '../../builder/filter-resolver.js';
import { composeHtmlTemplate } from '../../builder/html-composer.js';
import { getBuiltinPreambleFilterNames } from '../../builder/preamble-loader.js';
import { DEFAULT_SITE_CONFIG } from '../../config/site-config.js';
import * as logger from '../../lib/logger.js';
import { world } from './cli-world.steps.ts';

type TipoDoc = 'file' | 'collection' | 'creator';

function configConBloques(bloques: string[]): Parameters<typeof composeHtmlTemplate>[0] {
  return {
    ...DEFAULT_SITE_CONFIG,
    format: {
      ...DEFAULT_SITE_CONFIG.format,
      html: { ...DEFAULT_SITE_CONFIG.format.html, blocks: bloques as never },
    },
  };
}

Given('que la plantilla HTML se compone para {string}', async (tipo: string) => {
  world.plantilla = await composeHtmlTemplate(DEFAULT_SITE_CONFIG, undefined, tipo as TipoDoc);
});

Given('que compongo la plantilla HTML con los bloques {string}', async (bloques: string) => {
  const lista = bloques
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  world.plantilla = await composeHtmlTemplate(configConBloques(lista));
});

function celdas(texto: string): string {
  return texto.replace(/<br>/g, '\n').replace(/\\n/g, '\n');
}

Then('la plantilla dice {string}', (texto: string) => {
  const quiere = celdas(texto);
  if (!world.plantilla.includes(quiere)) throw new Error(`la plantilla no dice ${JSON.stringify(quiere)}`);
});

Then('la plantilla no dice {string}', (texto: string) => {
  const noQuiere = celdas(texto);
  if (world.plantilla.includes(noQuiere)) {
    throw new Error(`la plantilla sí dice ${JSON.stringify(noQuiere)} y no debería`);
  }
});

Then('la plantilla ordena {string}', (cadena: string) => {
  let anterior = -1;
  for (const texto of cadena.split(',').map((t) => t.trim())) {
    const donde = world.plantilla.indexOf(celdas(texto), anterior + 1);
    if (donde < 0) throw new Error(`la plantilla no tiene ${JSON.stringify(celdas(texto))} después de lo anterior`);
    anterior = donde;
  }
});

Then('el masonry trae {string}', (texto: string) => {
  const inicio = world.plantilla.indexOf('<main');
  const bloque = world.plantilla.slice(inicio, world.plantilla.indexOf('</main>', inicio));
  if (!bloque.includes(texto)) throw new Error(`el masonry no trae ${JSON.stringify(texto)}`);
});

Then('los nombres de los filtros del paquete se memoizan', () => {
  const a = getBuiltinFilterNames();
  const b = getBuiltinFilterNames();
  if (a !== b) throw new Error('dos llamadas dieron referencias distintas: se escaneó dos veces');
  if (a.length === 0) throw new Error('el paquete no trae filtros');
});

Then('los nombres de los preámbulos del paquete se memoizan', () => {
  const a = getBuiltinPreambleFilterNames();
  const b = getBuiltinPreambleFilterNames();
  if (a !== b) throw new Error('dos llamadas dieron referencias distintas: se escaneó dos veces');
  if (a.length === 0) throw new Error('el paquete no trae preámbulos');
});

Given('que pregunto por el filtro {string}', (nombre: string) => {
  world.filtroPreguntado = nombre;
});

When('busco su nombre completo', () => {
  world.sugerencia = suggestFilterName(world.filtroPreguntado as string);
});

Then('el nombre completo es {string}', (esperado: string) => {
  if (world.sugerencia !== esperado) {
    throw new Error(`es ${JSON.stringify(world.sugerencia)} y debería ser ${JSON.stringify(esperado)}`);
  }
});

Then('no hay nombre completo', () => {
  if (world.sugerencia !== undefined) {
    throw new Error(`hay nombre completo ${JSON.stringify(world.sugerencia)} y no debería`);
  }
});

Given('que los filtros lua desactivados son {string}', (lista: string) => {
  world.desactivadosFiltros = lista === 'ninguno' ? undefined : (JSON.parse(lista) as string[]);
});

Given('que la disabled list de filtros es {string}', (lista: string) => {
  world.filtrosDesactivados = JSON.parse(lista) as string[];
});

When('valido los filtros desactivados', () => {
  const espia = spyOn(logger, 'logWarning').mockImplementation(() => undefined);
  try {
    validateDisabledFilters(world.desactivadosFiltros);
    world.avisosFiltros = espia.mock.calls.map((c) => String(c[0]));
  } finally {
    espia.mockRestore();
  }
});

Then('no hay ningún aviso', () => {
  if (world.avisosFiltros.length > 0) {
    throw new Error(`hubo avisos: ${JSON.stringify(world.avisosFiltros)}`);
  }
});

Then('el aviso dice {string}', (motivo: string) => {
  if (!world.avisosFiltros.some((a) => a.includes(motivo))) {
    throw new Error(`ningún aviso dice ${JSON.stringify(motivo)}. Hubo: ${JSON.stringify(world.avisosFiltros)}`);
  }
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFilterGroups, resolveLuaFilters, resolveUserLuaFilters } from '../../builder/filter-resolver.js';
import { loadSiteConfig } from '../../config/config-loader.js';

Given('que el proyecto sobrescribe el filtro {string}', (ruta: string) => {
  const destino = join(world.root, ruta);
  mkdirSync(join(destino, '..'), { recursive: true });
  writeFileSync(destino, '-- test\n', 'utf8');
});

Given('que el proyecto declara el filtro de usuario {string}', (ruta: string) => {
  const destino = join(world.root, ruta);
  mkdirSync(join(destino, '..'), { recursive: true });
  writeFileSync(destino, '-- test\n', 'utf8');
  writeFileSync(join(world.root, 'iteraciones.config.yaml'), `luaFilters:\n  - ${ruta}\n`, 'utf8');
});

Given('que la raíz del proyecto tiene un archivo de configuración vacío', () => {
  writeFileSync(join(world.root, 'iteraciones.config.yaml'), '', 'utf8');
});

Given('que el proyecto declara un filtro de usuario que no existe', () => {
  writeFileSync(join(world.root, 'iteraciones.config.yaml'), 'luaFilters:\n  - filters/no-existe.lua\n', 'utf8');
});

When('resuelvo los filtros del paquete por capa', async () => {
  world.capas = (await resolveLuaFilters(world.filtrosDesactivados, world.root || undefined)) as unknown;
});

When('resuelvo los grupos de filtros del proyecto', async () => {
  world.grupos = await loadFilterGroups(DEFAULT_SITE_CONFIG, undefined, world.root || undefined);
});

When('resuelvo los filtros de usuario del proyecto', async () => {
  const espia = spyOn(logger, 'logWarning').mockImplementation(() => undefined);
  try {
    world.usuarios = await resolveUserLuaFilters(world.root, await loadSiteConfig(world.root));
    world.avisosFiltros = espia.mock.calls.map((c) => String(c[0]));
  } finally {
    espia.mockRestore();
  }
});

Then('la capa {string} tiene {int} filtros', (capa: string, cuantos: number) => {
  const lista = capaDe(capa);
  if (lista.length !== cuantos) {
    throw new Error(`la capa ${capa} tiene ${lista.length} filtros y son ${cuantos}: ${JSON.stringify(lista)}`);
  }
});

Then('el filtro {int} de la capa {string} acaba en {string}', (cual: number, capa: string, sufijo: string) => {
  const lista = capaDe(capa);
  const ruta = lista[cual - 1] ?? '';
  if (!ruta.endsWith(sufijo)) {
    throw new Error(`el filtro ${cual} de ${capa} es ${JSON.stringify(ruta)} y debería acabar en ${sufijo}`);
  }
});

function nombresResueltos(): Set<string> | undefined {
  return (world.capas as { resolvedNames?: Set<string> }).resolvedNames;
}

function capaDe(capa: string): string[] {
  return (world.capas as unknown as Record<string, string[]>)[capa] ?? [];
}

Then('la capa {string} no trae {string}', (capa: string, sufijo: string) => {
  const lista = capaDe(capa);
  const culpable = lista.find((r) => r.endsWith(sufijo));
  if (culpable) throw new Error(`la capa ${capa} sí trae ${JSON.stringify(culpable)} y no debería`);
});

Then('el filtro {int} de la capa {string} es el del proyecto', (cual: number, capa: string) => {
  const lista = capaDe(capa);
  const ruta = lista[cual - 1] ?? '';
  if (!ruta.startsWith(world.root)) {
    throw new Error(`el filtro ${cual} de ${capa} es ${JSON.stringify(ruta)} y no es el del proyecto`);
  }
});

Then('el nombre {string} no quedó resuelto', (nombre: string) => {
  if (nombresResueltos()?.has(nombre)) throw new Error(`${nombre} sí quedó resuelto y no debía`);
});

Then('el grupo {string} tiene {int} filtros', (grupo: string, cuantos: number) => {
  const lista = (world.grupos as Record<string, string[]>)[grupo] ?? [];
  if (lista.length !== cuantos) {
    throw new Error(`el grupo ${grupo} tiene ${lista.length} y son ${cuantos}: ${JSON.stringify(lista)}`);
  }
});

Then('el filtro {int} del grupo {string} acaba en {string}', (cual: number, grupo: string, sufijo: string) => {
  const ruta = ((world.grupos as Record<string, string[]>)[grupo] ?? [])[cual - 1] ?? '';
  if (!ruta.endsWith(sufijo)) throw new Error(`el filtro ${cual} acaba en ${JSON.stringify(ruta)} y debería en ${sufijo}`);
});

Then('el filtro {int} del grupo {string} es el del proyecto', (cual: number, grupo: string) => {
  const ruta = ((world.grupos as Record<string, string[]>)[grupo] ?? [])[cual - 1] ?? '';
  if (!ruta.startsWith(world.root)) throw new Error(`el filtro ${cual} es ${JSON.stringify(ruta)} y no es del proyecto`);
});

Then('los filtros de usuario son {int}', (cuantos: number) => {
  const lista = (world.usuarios as string[]) ?? [];
  if (lista.length !== cuantos) {
    throw new Error(`son ${lista.length} y son ${cuantos}: ${JSON.stringify(lista)}`);
  }
});

Then('el filtro de usuario {int} acaba en {string}', (cual: number, sufijo: string) => {
  const ruta = ((world.usuarios as string[]) ?? [])[cual - 1] ?? '';
  if (!ruta.endsWith(sufijo)) throw new Error(`acaba en ${JSON.stringify(ruta)} y debería en ${sufijo}`);
});

Then('el filtro de usuario {int} es una ruta absoluta', (cual: number) => {
  const ruta = ((world.usuarios as string[]) ?? [])[cual - 1] ?? '';
  if (!ruta.startsWith(world.root)) throw new Error(`la ruta ${JSON.stringify(ruta)} no es absoluta dentro del proyecto`);
});
