import { spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { babelOptionsForLang, composeLatexTemplate } from '../../builder/latex-preamble.js';
import type { PreambleFilter } from '../../builder/preamble-loader.js';
import {
  getBuiltinPreambleFilterInfos,
  getBuiltinPreambleFilterNames,
  loadPreambleFilters,
  resolveEffectiveDisabledPreamble,
  validateDisabledPreambleFilters,
  validatePreambleDependencies,
} from '../../builder/preamble-loader.js';
import { world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — los contratos del preámbulo LaTeX.
 *
 * `preamble.test.ts` tiene 72 casos y casi todos son la misma pregunta con
 * otros datos: **¿qué texto exacto lleva el `.tex` que se entrega al autor?**
 * El `.tex` es la salida observable —lo que pandoc compila a PDF—, así que
 * el Gherkin encaja aquí de verdad: se lee la regla ("con índice, el LaTeX
 * trae `\tableofcontents` entre condicionales") y no la cadena.
 *
 * ## Por qué hay una tabla de fragmentos y no una lista de `toContain`
 *
 * Escribir cada fragmento como un `toContain` produce un test que hay que
 * actualizar fragmento por fragmento cuando el template cambia de forma. La
 * tabla `fragmento | porque` deja el fragmento como dato y el porqué como
 * prosa, que es lo que un revisor necesita leer.
 *
 * ## Por qué el nombre de la función no aparece en el feature
 *
 * `babelOptionsForLang('fr-CA') === 'french'` es un contrato, no un detalle de
 * implementación: cambiar el nombre de la función no debe obligar a reescribir
 * el feature. Por eso los pasos hablan de "el idioma del documento" y no de
 * la función que lo resuelve.
 */

/** Los `opts` que usa `preamble.test.ts` en casi todos sus casos. */
type Opts = Parameters<typeof composeLatexTemplate>[0];

function opts(over: Partial<Opts> = {}): Opts {
  return { toc: true, preambleFilters: [], bibFiles: [], ...over };
}

function latex(): string {
  if (!world.latex) throw new Error('no se ha compuesto ningún LaTeX todavía');
  return world.latex;
}

function exige(texto: string, porque: string): void {
  if (!latex().includes(texto)) {
    throw new Error(`el LaTeX no trae ${JSON.stringify(texto)} (${porque}). Se compone así:\n${latex()}`);
  }
}

function prohibe(texto: string, porque: string): void {
  if (latex().includes(texto)) {
    throw new Error(`el LaTeX sí trae ${JSON.stringify(texto)} y no debería (${porque})`);
  }
}

Given('que compongo el LaTeX del documento', async () => {
  world.latex = await composeLatexTemplate(opts());
});

Given('que compongo el LaTeX sin índice', async () => {
  world.latex = await composeLatexTemplate(opts({ toc: false }));
});

/**
 * La ruta de una bibliografía con `%` y `_` en el nombre. El `%` se escapa
 * porque LaTeX lo toma por comentario; el `_` NO, porque en una ruta no es un
 * subíndice y escaparlo rompería el archivo.
 */
Given('que compongo el LaTeX con una bibliografía de nombre awkward', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-preamble-'));
  const bib = join(cwd, 'mi_bib%1.bib');
  writeFileSync(bib, '@book{k1, title={T}, year={2020}}\n');
  world.bibliografia = bib;
  world.latex = await composeLatexTemplate(opts({ bibFiles: [bib] }));
});

Given('que el idioma del documento es {string}', (lang: string) => {
  world.idioma = lang;
});

Given('que los filtros desactivados son {string}', (lista: string) => {
  world.desactivados = lista === 'ninguno' ? undefined : (JSON.parse(lista) as string[]);
});

Then('las opciones de babel del PDF son {string}', (esperado: string) => {
  const opciones = babelOptionsForLang(world.idioma ?? 'es-MX', new Set<string>());
  if (opciones !== esperado) {
    throw new Error(`${world.idioma} produce ${JSON.stringify(opciones)} y el PDF espera ${JSON.stringify(esperado)}`);
  }
});

Then('un idioma desconocido avisa una vez por build', () => {
  const espia = spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    // Mismo registro (mismo build): un solo warning aunque se consulte dos
    // veces. Registro distinto (segundo build en el mismo proceso): warning de
    // nuevo, porque el autor ya pudo ver el primero.
    const registrados = new Set<string>();
    babelOptionsForLang('xx-YY', registrados);
    babelOptionsForLang('xx-YY', registrados);
    const primero = espia.mock.calls.map((c) => String(c[0])).join('');
    espia.mockClear();
    babelOptionsForLang('xx-YY', new Set<string>());
    const segundo = espia.mock.calls.map((c) => String(c[0])).join('');
    const cuenta = (t: string) => (t.match(/sin opciones babel conocidas/g) ?? []).length;
    if (cuenta(primero) !== 1 || cuenta(segundo) !== 1) {
      throw new Error(`esperaba 1 warning en el primer build y 1 en el segundo; hubo ${cuenta(primero)} y ${cuenta(segundo)}`);
    }
  } finally {
    espia.mockRestore();
  }
});

Then('validar esos filtros no dice nada', () => {
  try {
    validateDisabledPreambleFilters(world.desactivados);
  } catch (e) {
    throw new Error(`un filtro que existe no debería Romper nada: ${(e as Error).message}`);
  }
});

Then('validar esos filtros dice que {string} no existe', (desconocido: string) => {
  try {
    validateDisabledPreambleFilters(world.desactivados);
  } catch (e) {
    const esperado = `disabledPreambleFilters: "${desconocido}" no coincide con ningún preamble filter`;
    if (!(e as Error).message.includes(esperado)) {
      throw new Error(`el error no dice lo esperado. Dijo: ${(e as Error).message}`);
    }
    return;
  }
  throw new Error(`validar ${JSON.stringify(world.desactivados)} no falló y debía`);
});

Then('la lista efectiva de desactivados trae {string}', (nombre: string) => {
  const efectiva = resolveEffectiveDisabledPreamble(world.desactivados);
  if (!efectiva.includes(nombre)) {
    throw new Error(`${nombre} no está en la lista efectiva ${JSON.stringify(efectiva)}`);
  }
});

Then('la lista efectiva de desactivados no trae {string}', (nombre: string) => {
  const efectiva = resolveEffectiveDisabledPreamble(world.desactivados);
  if (efectiva.includes(nombre)) {
    throw new Error(`${nombre} sí está en la lista efectiva y no debería`);
  }
});

Then('la lista efectiva de desactivados trae {string} una sola vez', (nombre: string) => {
  const efectiva = resolveEffectiveDisabledPreamble(world.desactivados);
  const veces = efectiva.filter((n) => n === nombre).length;
  if (veces !== 1) {
    throw new Error(`${nombre} aparece ${veces} veces y tiene que aparecer una: ${JSON.stringify(efectiva)}`);
  }
});

Then('la lista original de desactivados no cambió', () => {
  // La resolución devuelve una lista nueva: si mutara la del config, el
  // siguiente build del mismo proceso heredaría el 08-hyperref agregado.
  const antes = JSON.stringify(world.desactivados ?? null);
  const copia = world.desactivados ? [...world.desactivados] : world.desactivados;
  resolveEffectiveDisabledPreamble(world.desactivados);
  const despues = JSON.stringify(world.desactivados ?? null);
  if (antes !== despues || world.desactivados === copia) {
    throw new Error(`la lista original cambió de ${antes} a ${despues}, o la resolución la devolvió en el sitio`);
  }
});

Then('los problemas de dependencias están vacíos', () => {
  const issues = validatePreambleDependencies(world.desactivados);
  if (issues.length > 0) {
    throw new Error(`esperaba cero problemas y hubo ${JSON.stringify(issues)}`);
  }
});

Then('los problemas de dependencias avisan que falta {string}', (falta: string) => {
  const issues = validatePreambleDependencies(world.desactivados);
  if (!issues.some((i: { message: string }) => i.message.includes(falta))) {
    throw new Error(`esperaba un problema que mencionara ${JSON.stringify(falta)} y hubo ${JSON.stringify(issues)}`);
  }
});

Then('los problemas de dependencias no tienen errores', () => {
  const issues = validatePreambleDependencies(world.desactivados);
  const errores = issues.filter((i: { severity: string }) => i.severity === 'error');
  if (errores.length > 0) {
    throw new Error(`esperaba cero errores y hubo ${JSON.stringify(errores)}`);
  }
});

Then('los problemas deDependencies no marcan 99-pdfx', () => {
  const issues = validatePreambleDependencies(world.desactivados);
  if (issues.some((i: { message: string }) => i.message.includes('99-pdfx'))) {
    throw new Error(`esperaba que nadie se quejara de 99-pdfx y hubo ${JSON.stringify(issues)}`);
  }
});

/**
 * El `.tex` del proyecto gana al del paquete. Es la válvula de escape: si el
 * autor necesita cambiar un preámbulo y no hay filtro para eso, escribe el
 * archivo con el mismo nombre en `preamble/` y lo sustituye.
 */
Given('que el proyecto reemplaza el filtro {string} con su propio .tex', (nombre: string) => {
  world.cwd = mkdtempSync(join(tmpdir(), 'iteraciones-preamble-'));
  mkdirSync(join(world.cwd, 'preamble'), { recursive: true });
  writeFileSync(join(world.cwd, 'preamble', `${nombre}.tex`), 'hyphenation{OverridePrueba}\n');
});

Then('el filtro {string} trae el contenido del proyecto', async (nombre: string) => {
  const filtros: PreambleFilter[] = await loadPreambleFilters(world.desactivados, world.cwd);
  const mio = filtros.find((f) => f.name === nombre);
  if (!mio?.content.includes('OverridePrueba')) {
    throw new Error(`el .tex del proyecto no llegó al filtro ${nombre}: ${mio?.content.slice(0, 120)}`);
  }
  // Y el del paquete no se coló detrás del suyo.
  if (mio.content.includes('Separacion silabica')) {
    throw new Error(`el ${nombre} trae el contenido del paquete además del del proyecto`);
  }
});

Then('los filtros del paquete son {int}', (cuantos: number) => {
  const nombres = getBuiltinPreambleFilterNames();
  if (nombres.length !== cuantos) {
    throw new Error(`hay ${nombres.length} filtros y son ${cuantos}: ${JSON.stringify(nombres)}`);
  }
});

Then('cada filtro del paquete tiene descripción', async () => {
  const infos = await getBuiltinPreambleFilterInfos();
  const sinDescripcion = infos.filter((i: { description: string }) => i.description.length === 0).map((i: { name: string }) => i.name);
  if (sinDescripcion.length > 0) {
    throw new Error(`estos filtros no dicen qué hacen: ${JSON.stringify(sinDescripcion)}`);
  }
});

Then('la cola de imprenta es {string}', (cola: string) => {
  // Los tres últimos filtros son la cola de imprenta (fondo, marcas de corte,
  // PDF/X-1a) y ocupan ese lugar a propósito: ningún filter futuro puede
  // quedar después (#1952).
  const nombres = getBuiltinPreambleFilterNames();
  const ultimos = nombres.slice(-3);
  if (JSON.stringify(ultimos) !== JSON.stringify(JSON.parse(cola))) {
    throw new Error(`la cola es ${JSON.stringify(ultimos)} y debería ser ${cola}`);
  }
  const maximo = nombres.reduce((max: number, n: string) => {
    const m = n.match(/^(\d+)-/);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  if (maximo !== 99) throw new Error(`el filtro más alto es ${maximo} y tiene que ser 99 para dejar libre la cola`);
});

Then('todos los filtros del paquete traen su .tex', async () => {
  const filtros: PreambleFilter[] = await loadPreambleFilters();
  const vacios = filtros.filter((f) => f.content.trim() === '').map((f) => f.name);
  if (vacios.length > 0) throw new Error(`estos filtros llegan vacíos: ${JSON.stringify(vacios)}`);
});

Then('los filtros precargados son {int}', async (cuantos: number) => {
  const filtros: PreambleFilter[] = await loadPreambleFilters(world.desactivados);
  if (filtros.length !== cuantos) {
    throw new Error(`se cargaron ${filtros.length} filtros y son ${cuantos}`);
  }
});

Then('el filtro {string} no viene precargado', async (nombre: string) => {
  const filtros: PreambleFilter[] = await loadPreambleFilters(world.desactivados);
  if (filtros.some((f) => f.name === nombre)) {
    throw new Error(`${nombre} estaba en la disabled list y aun así se cargó`);
  }
});

Then('el LaTeX escapa el % de la bibliografía y deja el _ quieto', () => {
  exige(`\\addbibresource{${world.bibliografia.replace('%', '\\%')}}`, 'la ruta de la biblatexografía con el % escapado');
  if (!latex().includes('mi_bib')) throw new Error('el nombre de la bibliografía desapareció del LaTeX');
});

/**
 * El fragmento va en docstring y no en `{string}` por una razón concreta: las
 * llaves del LaTeX son sintaxis de cucumber. `el LaTeX trae "\pagestyle{empty}"`
 * no es un argumento, es un `{empty}` inline que cucumber no reconoce, y el
 * paso falla como "undefined" sin decir por qué.
 *
 * Un docstring no tiene ese problema y además se lee como LaTeX: los saltos de
 * línea son parte del contrato y se ven.
 */
Then('el LaTeX trae:', (fragmento: string) => {
  exige(fragmento.replace(/\n$/, ''), 'el fragmento que el autor recibe en su .tex');
});

Then('el LaTeX no trae:', (fragmento: string) => {
  prohibe(fragmento.replace(/\n$/, ''), 'lo contrario rompería el documento o duplicaría el contenido');
});

Then('el LaTeX pone esto antes:', (primero: string) => {
  world.antesDe = primero.replace(/\n$/, '');
  const donde = latex()
    .split('\n')
    .findIndex((l) => l.includes(world.antesDe));
  if (donde < 0) throw new Error(`el LaTeX no tiene ${JSON.stringify(world.antesDe)}`);
  world.desdeLinea = donde;
});

Then('esto va más adelante:', (segundo: string) => {
  const donde = latex()
    .split('\n')
    .findIndex((l) => l.includes(segundo.replace(/\n$/, '')));
  if (donde < 0) throw new Error(`el LaTeX no tiene el segundo texto`);
  if (world.desdeLinea >= donde) {
    throw new Error(`${JSON.stringify(world.antesDe)} (línea ${world.desdeLinea + 1}) no va antes que el segundo texto (línea ${donde + 1})`);
  }
});

Then('el $body$ queda entre dos líneas en blanco', () => {
  const lineas = latex().split('\n');
  const donde = lineas.indexOf('$body$');
  if (donde < 0) throw new Error('el LaTeX no tiene $body$');
  // El cuerpo del documento se pega al preámbulo y a lo que sigue. Sin las
  // líneas en blanco, el primer párrafo del autor hereda el `\parindent` del
  // preámbulo y el PDF sale con la sangría corrida.
  if (lineas[donde - 1] !== '' || lineas[donde + 1] !== '') {
    throw new Error(`$body$ no está aislado:\n${lineas.slice(donde - 2, donde + 3).join('\n')}`);
  }
});

Then('el LaTeX termina con:', (linea: string) => {
  const lineas = latex().split('\n');
  const ultima = lineas[lineas.length - 1];
  if (ultima !== linea.replace(/\n$/, '')) {
    throw new Error(`la última línea es ${JSON.stringify(ultima)} y debería ser ${JSON.stringify(linea)}`);
  }
});
