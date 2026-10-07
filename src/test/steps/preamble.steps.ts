import { spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import {
  applyPrintQueueDynamics,
  babelOptionsForLang,
  buildCropContent,
  buildPdfxPagesattr,
  composeLatexTemplate,
  detectPageSize,
} from '../../builder/latex-preamble.js';
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

/** Exige que `texto` esté en `contenido`. El mensaje nombra el archivo. */
function exige(contenido: string, archivo: string, textos: string[]): void {
  for (const texto of textos) {
    if (!contenido.includes(texto)) {
      throw new Error(`${archivo} no trae ${JSON.stringify(texto)}`);
    }
  }
}

function prohibe(contenido: string, archivo: string, textos: string[]): void {
  for (const texto of textos) {
    if (contenido.includes(texto)) {
      throw new Error(`${archivo} sí trae ${JSON.stringify(texto)} y no debería`);
    }
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
  exige(latex(), 'el .tex del autor', [`\\addbibresource{${world.bibliografia.replace('%', '\\%')}}`]);
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
/**
 * El contenido de un filtro del paquete, que es un `.tex` suelto. Se lee por
 * nombre y se mira con docstring, porque los fragmentos son LaTeX con llaves
 * y los pasos de LaTeX también las llevan.
 */
When('miro el filtro {string}', async (nombre: string) => {
  const filtros: PreambleFilter[] = await loadPreambleFilters();
  world.filtro = filtros.find((f) => f.name === nombre);
  if (!world.filtro) {
    throw new Error(`el paquete no trae el filtro ${nombre}`);
  }
  world.filtroNombre = nombre;
});

Then('el filtro trae:', (fragmento: string) => {
  exige(world.filtro?.content ?? '', `${world.filtroNombre}.tex`, [fragmento.replace(/<br>/g, '\n').replace(/\\n$/, '')]);
});

Then('el filtro no trae:', (fragmento: string) => {
  const c = world.filtro?.content ?? '';
  const texto = fragmento.replace(/<br>/g, '\n').replace(/\\n$/, '');
  if (c.includes(texto)) throw new Error(`${world.filtroNombre}.tex sí trae ${JSON.stringify(texto)} y no debería`);
});

/** El filtro que se está mirando se compara contra otro, para reglas de par. */
When('miro además el filtro {string}', async (nombre: string) => {
  const filtros: PreambleFilter[] = await loadPreambleFilters();
  world.filtroPareja = filtros.find((f) => f.name === nombre);
  if (!world.filtroPareja) throw new Error(`el paquete no trae el filtro ${nombre}`);
  world.filtroParejaNombre = nombre;
});

Then('el filtro que miro además trae:', (fragmento: string) => {
  exige(world.filtroPareja?.content ?? '', world.filtroParejaNombre, [fragmento.replace(/<br>/g, '\n')]);
});

Then('el LaTeX trae:', (fragmento: string) => {
  exige(latex(), 'el .tex del autor', [fragmento.replace(/\n$/, '').replace(/<br>/g, '\n')]);
});

Then('el LaTeX no trae:', (fragmento: string) => {
  prohibe(latex(), 'el .tex del autor', [fragmento.replace(/\n$/, '').replace(/<br>/g, '\n')]);
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

/**
 * #1810 — los valores de maquetación editorial del `19-maketitle`.
 *
 * El maketitle de KOMA es un bloque de LaTeX de doscientas líneas. Cada
 * ajuste de aire, de ancho y de centrado vive en una línea concreta, y
 * cambiarla cambia la portada. Por eso los pasos hablan de "la dedicatoria
 * va centrada" y no de la línea donde está.
 *
 * ## El código y los comentarios son dos cosas
 *
 * El filtro lleva comentarios `%` que explican por qué se hizo así. Un `Then`
 * que busque `\next@tpage` en el texto completo fallaría por el comentario que
 * lo explica. Por eso hay un paso que mira el CÓDIGO, sin comentarios.
 */

/** Compone el LaTeX con un solo filtro del paquete, para aislar su salida. */
When('compongo el LaTeX con el filtro {string}', async (nombre: string) => {
  const filtros: PreambleFilter[] = await loadPreambleFilters();
  const elegido = filtros.filter((f) => f.name === nombre);
  world.latex = await composeLatexTemplate({ toc: true, preambleFilters: elegido, bibFiles: [] });
});

/**
 * El código del filtro, sin las líneas de comentario. Los comentarios explican
 * la decisión; el código es lo que se compila. Un fragmento que sólo aparezca
 * en un comentario no está en el código.
 */

Then('el código del filtro no trae:', (fragmento: string) => {
  const codigo = (world.filtro?.content ?? '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('%'))
    .join('\n');
  prohibe(codigo, `${world.filtroNombre}.tex (sin comentarios)`, [fragmento.replace(/<br>/g, '\n').replace(/\n$/, '')]);
});

Then('el LaTeX no lleva caracteres de control', () => {
  // Un backspace o un tab en el LaTeX se come el carácter de delante y la
  // portada sale con una palabra menos. No hay forma de verlo en el PDF.
  for (const malo of ['\b', '\t']) {
    if (latex().includes(malo)) {
      throw new Error(`el LaTeX lleva un carácter de control: ${JSON.stringify(latex().slice(0, 200))}`);
    }
  }
});

/** Un bloque va después de otro dentro del mismo filtro. */

/** El número de veces que aparece un comando: una vez es el contrato. */
Then('el filtro trae {string} {int} vez', (comando: string, veces: number) => {
  const contenido = world.filtro?.content ?? '';
  const encontradas = contenido.split(comando).length - 1;
  if (encontradas !== veces) {
    throw new Error(`${comando} aparece ${encontradas} veces y son ${veces}`);
  }
});

/**
 * #1975 — el crop y el PDF/X-1a se calculan de las dimensiones del papel.
 *
 * El crop necesita 6 mm de sangrado en las cuatro dimensiones: el papel se
 * corta y sin sangrado el borde de color llega al filo. El PDF/X-1a necesita
 * las cuatro boxes (Media, Crop, Bleed, Trim) y el TrimBox con un offset de
 * 3 mm, que es lo que la certificación mide.
 *
 * ## Los filtros se pasan como datos, no se cargan
 *
 * `detectPageSize` y `applyPrintQueueDynamics` trabajan sobre la LISTA de
 * filtros, no sobre el filesystem. Pasarlos como datos hace que cada escenario
 * diga qué filtros tiene el proyecto, en vez de depender de lo que haya en el
 * paquete.
 */

/** Un filtro del paquete, con su nombre y su contenido. */
function _filtro(nombre: string, contenido: string): PreambleFilter {
  return { name: nombre, content: contenido };
}

/**
 * Los filtros llegan como JSON en un `{string}` y no en un docstring: las
 * cadenas de LaTeX llevan `\` y comillas, y un docstring las come.
 *
 * La copia original es la que comprueba "quedó intacto": sin ella el paso
 * compararía el filtro consigo mismo y pasaría siempre.
 */
Given('que el proyecto tiene los filtros:', (lista: string) => {
  // `nombre|contenido` separado por `;;`. Sin JSON: las barras del LaTeX no
  // se escapaban igual en cada herramienta y el parseo fallaba sin decir por
  // qué. Con `|` y `;;` no hay nada que escapar.
  // `nombre contenido` separado por `;;`: el nombre es la primera palabra y
  // el contenido es el resto, porque el contenido lleva espacios y barras.
  const pares = lista
    .split(';;')
    .map((par) => par.trim())
    .filter(Boolean)
    .map((par) => {
      const espacio = par.indexOf(' ');
      return {
        name: espacio < 0 ? par : par.slice(0, espacio),
        content: espacio < 0 ? '' : par.slice(espacio + 1),
      };
    });
  world.filtrosDinamica = pares;
  world.filtrosOriginales = pares.map((f) => ({ ...f }));
});

When('detecto el tamaño del papel', () => {
  world.papel = detectPageSize(world.filtrosDinamica as PreambleFilter[]);
});

Then('el papel mide {int} por {int} con {int} de texto', (w: number, h: number, textW: number) => {
  // Con tolerancia: el papel sale de milímetros convertidos y 215.9 no es 216.
  // Redondear aquí hacía que el caso de letter fallara por 0.9.
  const p = world.papel as { w: number; h: number; textW: number };
  const cerca = (a: number, b: number) => Math.abs(a - b) < 1;
  if (!cerca(p.w, w) || !cerca(p.h, h) || !cerca(p.textW, textW)) {
    throw new Error(`mide ${JSON.stringify(p)} y debería medir ${w}x${h} con ${textW} de texto`);
  }
});

When('compongo el contenido del crop', () => {
  const p = world.papel as { w: number; h: number };
  world.crop = buildCropContent(p.w, p.h);
});

Then('el crop trae {string}', (texto: string) => {
  exige(world.crop ?? '', '98-crop.tex', [texto]);
});

When('compongo las páginas del PDFX', () => {
  const p = world.papel as { w: number; h: number };
  world.pdfx = buildPdfxPagesattr(p.w, p.h, world.conCrop === true);
});

Then('las páginas del PDFX traen {string}', (texto: string) => {
  exige(world.pdfx ?? '', '99-pdfx.tex', [texto]);
});

Given('que el crop está {string}', (estado: string) => {
  world.conCrop = estado === 'activo';
});

When('aplico la dinámica de la cola de imprenta', () => {
  world.filtrosDinamica = applyPrintQueueDynamics(world.filtrosDinamica as PreambleFilter[]);
});

Then('el filtro {string} trae {string}', (nombre: string, texto: string) => {
  const contenido = (world.filtrosDinamica as PreambleFilter[]).find((f) => f.name === nombre)?.content ?? '';
  exige(contenido, `${nombre}.tex`, [texto]);
});

Then('el filtro {string} no trae {string}', (nombre: string, texto: string) => {
  const contenido = (world.filtrosDinamica as PreambleFilter[]).find((f) => f.name === nombre)?.content ?? '';
  prohibe(contenido, `${nombre}.tex`, [texto]);
});

Then('el filtro {string} quedó intacto', (nombre: string) => {
  const original = (world.filtrosOriginales as PreambleFilter[]).find((f) => f.name === nombre)?.content ?? '';
  const ahora = (world.filtrosDinamica as PreambleFilter[]).find((f) => f.name === nombre)?.content ?? '';
  if (original !== ahora) {
    throw new Error(`${nombre} cambió de ${JSON.stringify(original)} a ${JSON.stringify(ahora)} y no debía`);
  }
});
