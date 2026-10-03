import { spyOn } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { After, Given, Then, When } from '@cucumber/cucumber';
import { runBuild, runDoctor, runFilters } from '../../cli/dispatcher.js';
import * as runModule from '../../lib/run.js';
import { capture, escribirEnProyecto, tempRoot, world } from './cli-world.steps.js';

/**
 * #2546 (onda 2) — tranche 6 de `cli-layer`: `doctor`, `doctor --info` y `list-filters`.
 *
 * ## El `Before` de este archivo es un solo caso: `pdftoppm`
 *
 * Un check opcional que falla tiene que verse fallando. La forma de verlo es
 * hacer que el binario no exista, y la única forma deEso es engañar al módulo
 * que lo busca. El espío vive en un `Given` y se devuelve en el `After`, como
 * cualquier otro estado global.
 *
 * ## `escribirEnProyecto` y no un helper propio
 *
 * Los pasos que arman proyectos escriben archivos en la raíz del mundo
 * compartido. La lista de configuraciones que necesita este bloque es corta y
 * cada una tiene un nombre: "proyecto de prueba", "proyecto con PDF",
 * "proyecto con 99-pdfx activo". Un helper por nombre es más legible que un
 * `Given` con un `{string}` que el que lee tiene que ir a buscar.
 */

const PREAMBLE_PDF = 'language: es-MX\nformat:\n  pdf:\n    generate: true\n';

/** El espío de `run.exec` del escenario que finge que `pdftoppm` no existe. */
let espioExec: { mockRestore: () => void } | undefined;

/**
 * La raíz del escenario, creándola si el `Given` anterior no la puso. Varios de
 * estos escenarios arrancan con la configuración —"dado que la raíz tiene una
 * configuración inválida"— y no con una raíz vacía, así que escribir sin
 * comprobar deja `join(undefined, …)`.
 */
function raiz(): string {
  if (!world.root) world.root = tempRoot('iteraciones-cli-');
  return world.root;
}

/** Config con un filtro de preámbulo desactivado por el usuario. */
function configConFiltroDesactivado(filtro: string): string {
  return `language: es-MX\nformat:\n  pdf:\n    disabledPreambleFilters:\n      - ${filtro}\n`;
}

/** El `JSON.parse` de `stdout`, como el de `validate --json`. */
function jsonSalida(): Record<string, unknown> {
  const crudo = world.stdout.trim();
  try {
    return JSON.parse(crudo) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`stdout no es JSON válido: ${(err as Error).message}\nva:\n${crudo}`);
  }
}

function lista(clave: string): Record<string, unknown>[] {
  const valor = jsonSalida()[clave];
  if (!Array.isArray(valor)) {
    throw new Error(`la clave ${JSON.stringify(clave)} del JSON no es una lista: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>[];
}

After(() => {
  // Devuelve el espío de `exec` aunque el escenario haya fallado antes de
  // terminar: si queda puesto, los `doctor` de los escenarios siguientes corren
  // contra un binario que no existe y fallan por el motivo equivocado.
  espioExec?.mockRestore();
  espioExec = undefined;
});

Given('que la raíz del proyecto tiene un proyecto con PDF', () => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', PREAMBLE_PDF);
});

Given('que la raíz del proyecto tiene un proyecto con 99-pdfx activo', () => {
  raiz();
  // `disabledPreambleFilters: []` deja los tres defaults activos, 99-pdfx
  // incluido: sin él el PDF no lleva los boxes y no hay nada que certificar.
  escribirEnProyecto('iteraciones.config.yaml', `${PREAMBLE_PDF}    disabledPreambleFilters: []\n`);
});

Given('que la raíz del proyecto tiene un proyecto con {word} desactivado', (filtro: string) => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', configConFiltroDesactivado(filtro));
});

Given('que la raíz del proyecto tiene una configuración inválida', () => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', ':: yaml inválido ::');
});

Given('que el proyecto tiene el archivo {string}', (relativa: string) => {
  writeFileSync(join(world.root, relativa), '@book{k1, title={T}}\n', 'utf8');
});

Given('que pdftoppm no está disponible', async () => {
  const real = runModule.exec;
  const espia = spyOn(runModule, 'exec').mockImplementation(async (cmd: string, args: string[], opciones?: Parameters<typeof runModule.exec>[2]) => {
    if (cmd === 'pdftoppm') throw new runModule.ProcessSpawnError('pdftoppm no encontrado');
    return real(cmd, args, opciones);
  });
  espioExec = espia;
});

When('pido la información de "doctor"', async () => {
  await capture(() => runDoctor(world.root, { info: true }));
});

When('listo los filtros en {int} columnas', async (columnas: number) => {
  await capture(() => runFilters(world.root, { columns: columnas }));
});

When('listo los filtros en {int} columnas con detalle', async (columnas: number) => {
  await capture(() => runFilters(world.root, { columns: columnas, verbose: true }));
});

When('listo los filtros pidiendo JSON', async () => {
  await capture(() => runFilters(world.root, { json: true }));
});

When('compilo el proyecto en la salida {string}', async (salida: string) => {
  await capture(() => runBuild(world.root, { outputDir: salida }));
});

Then('la salida no dice {string}', (texto: string) => {
  if (world.stdout.includes(texto)) {
    throw new Error(`la salida sí dice ${JSON.stringify(texto)} y no debería: ${JSON.stringify(world.stdout)}`);
  }
});

Then('la salida no lleva códigos ANSI', () => {
  if (world.stdout.includes('\x1b')) {
    throw new Error('la salida lleva códigos ANSI: se colaron en el render de los checks');
  }
});

Then('la salida lleva una elipsis', () => {
  if (!world.stdout.includes('…')) {
    throw new Error('la salida no lleva "…" y las descripciones deberían estar truncadas');
  }
});

Then('la salida lista {string} como activa con su primera oración', (filtro: string) => {
  // `latex/02-dictum  lua  Convierte …  [activo]`: el nombre, el tipo, la
  // primera oración de la descripción y el estado.
  const patron = new RegExp(`${filtro.replace(/[/]/g, '\\/')} {2,}\\w+ {2}Convierte[^\\n]*\\.[^\\n]*\\[activo\\]`);
  if (!patron.test(world.stdout)) {
    throw new Error(`la salida no lista ${filtro} con su primera oración y la marca de activo:\n${world.stdout.slice(0, 600)}`);
  }
});

Then('la línea de {string} dice {string}', (etiqueta: string, valor: string) => {
  const linea = world.stdout.split('\n').find((l) => l.includes(etiqueta));
  if (linea === undefined) {
    throw new Error(`no hay ninguna línea con ${JSON.stringify(etiqueta)}`);
  }
  if (!linea.includes(valor)) {
    throw new Error(`la línea de ${JSON.stringify(etiqueta)} no dice ${JSON.stringify(valor)}: ${JSON.stringify(linea)}`);
  }
});

Then('la línea de {string} no dice {string}', (etiqueta: string, valor: string) => {
  const linea = world.stdout.split('\n').find((l) => l.includes(etiqueta));
  if (linea === undefined) {
    throw new Error(`no hay ninguna línea con ${JSON.stringify(etiqueta)}`);
  }
  if (linea.includes(valor)) {
    throw new Error(`la línea de ${JSON.stringify(etiqueta)} dice ${JSON.stringify(valor)} y no debería: ${JSON.stringify(linea)}`);
  }
});

Then('las dos líneas de filtros de preámbulo están alineadas', () => {
  // La columna de valores la fija la etiqueta más larga. Si el padding se
  // calcula por etiqueta y no sobre el conjunto, las dos columnas se descuadran
  // y las dos listas dejan de leerse como columnas.
  const config = world.stdout.split('\n').find((l) => l.includes('filters de preámbulo desactivados (config):'));
  const defaults = world.stdout.split('\n').find((l) => l.includes('filters de preámbulo desactivados (defaults del paquete):'));
  if (config === undefined || defaults === undefined) {
    throw new Error('faltan las dos líneas de filtros de preámbulo');
  }
  if (config.indexOf('(') !== defaults.indexOf('(')) {
    throw new Error(`las dos líneas no alinean sus valores:\n${JSON.stringify(config)}\n${JSON.stringify(defaults)}`);
  }
});

Then('la línea del encabezado de la configuración lleva el prefijo {string}', (prefijo: string) => {
  const linea = world.stdout.split('\n').find((l) => l.includes('configuración del proyecto:'));
  if (linea === undefined) {
    throw new Error('no hay línea de encabezado de la configuración');
  }
  if (!linea.includes(prefijo)) {
    throw new Error(`el encabezado no lleva ${JSON.stringify(prefijo)}: ${JSON.stringify(linea)}`);
  }
});

Then('ninguna línea de la configuración lleva el prefijo {string}', (prefijo: string) => {
  // #2192: un prefijo por línea hace que el bloque se lea como veinte mensajes
  // distintos en vez de uno.
  const lineas = world.stdout.split('\n').filter((l) => l.includes('language:') || l.includes('toc:'));
  if (lineas.length < 2) {
    throw new Error(`esperaba al menos 2 líneas de configuración y hay ${lineas.length}`);
  }
  for (const linea of lineas) {
    if (linea.includes(prefijo)) {
      throw new Error(`la línea lleva el prefijo ${JSON.stringify(prefijo)} y sólo debería llevarlo el encabezado: ${JSON.stringify(linea)}`);
    }
  }
});

Then('el JSON declara al menos {int} check', (minimo: number) => {
  const checks = lista('checks');
  if (checks.length < minimo) {
    throw new Error(`el JSON declara ${checks.length} checks y esperaba al menos ${minimo}`);
  }
});

Then('el JSON declara al menos {int} check con error', (minimo: number) => {
  const conError = lista('checks').filter((c) => c.ok === false);
  if (conError.length < minimo) {
    throw new Error(`el JSON declara ${conError.length} checks con error y esperaba al menos ${minimo}`);
  }
});

Then('el JSON declara al menos {int} filtro', (minimo: number) => {
  const filtros = lista('filters');
  if (filtros.length < minimo) {
    throw new Error(`el JSON declara ${filtros.length} filtros y esperaba al menos ${minimo}`);
  }
});

Then('el JSON declara al menos {int} filtro de preámbulo', (minimo: number) => {
  const filtros = lista('preamble');
  if (filtros.length < minimo) {
    throw new Error(`el JSON declara ${filtros.length} filtros de preámbulo y esperaba al menos ${minimo}`);
  }
});

Then('el JSON declara el primer filtro de tipo {string}', (tipo: string) => {
  const primero = lista('filters')[0];
  if (primero?.type !== tipo) {
    throw new Error(`el primer filtro es de tipo ${JSON.stringify(primero?.type)} y esperaba ${JSON.stringify(tipo)}`);
  }
});

Then('el JSON declara el primer filtro de preámbulo de tipo {string}', (tipo: string) => {
  const primero = lista('preamble')[0];
  if (primero?.type !== tipo) {
    throw new Error(`el primer filtro de preámbulo es de tipo ${JSON.stringify(primero?.type)} y esperaba ${JSON.stringify(tipo)}`);
  }
});

Then('el JSON declara el estado del primer filtro', () => {
  const activo = lista('filters')[0]?.active;
  if (typeof activo !== 'boolean') {
    throw new Error(`el primer filtro declara active=${JSON.stringify(activo)} y esperaba un booleano`);
  }
});
