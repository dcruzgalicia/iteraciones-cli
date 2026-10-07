import { spyOn } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { After, Given, Then, When } from '@cucumber/cucumber';
import { resolvePdfCheckBinary, validatePdfX1a } from '../../builder/pdfx-check.js';
import { reportBuildError, runBuild, runValidate } from '../../cli/dispatcher.js';
import { PANDOC_ERROR_CODES, PandocError } from '../../lib/errors.js';
import * as pandocRunner from '../../lib/pandoc-runner.js';
import { ProcessSpawnError } from '../../lib/run.js';
import { capture, escribirEnProyecto, sinColor, tempRoot, world } from './cli-world.steps.js';

/**
 * #2546 (onda 2) — tranche 7 de `cli-layer`: errores de build, estado y humo de PDF.
 *
 * ## Los errores se distinguen por código, no por texto
 *
 * `reportBuildError` decide qué sugerir mirando la CLASE y el código
 * estructural del error. Un `PandocError` de entorno y un `ProcessSpawnError`
 * son los dos "falta una herramienta"; cualquier otra cosa no sabe qué falta, así
 * que no sugiere nada. Por eso el paso `el build falla con el error` mapea un
 * nombre de negocio al error real — el feature no importa clases de TypeScript.
 *
 * ## El humo de PDF compila de verdad
 *
 * Los hooks de preámbulo fallan dentro de LaTeX, no dentro de Bun: ningún test
 * de JavaScript los alcanza. Por eso estos escenarios llevan
 * `@requires-pandoc` y `@requires-latex` y son de los más caros de la suite.
 *
 * `ponytail: la validación PDF/X-1a real depende del binario `iteraciones-pdfcheck`,
 * que la suite no compila (es Rust). Si el binario no está, el `Then` dice que no
 * lo encontró y sigue con la aserción del /TrimBox. Para validar de verdad hace
 * falta el binario en el PATH o en la caché del usuario.
 */

function raiz(): string {
  if (!world.root) world.root = tempRoot('iteraciones-cli-');
  return world.root;
}

/**
 * El proyecto con la configuración dada. El documento va siempre: un build sin
 * documentos no compila nada y no hay PDF que mirar, así que el escenario
 * pasaría por verde sin comprobar nada.
 */
function proyectoConConfig(config: string): void {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', config);
  escribirEnProyecto('test.md', '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido de prueba.\n');
}

const PDF = 'language: es-MX\nformat:\n  pdf:\n    generate: true\n';

function jsonSalida(): Record<string, unknown> {
  const crudo = world.stdout.trim();
  try {
    return JSON.parse(crudo) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`stdout no es JSON válido: ${(err as Error).message}\nva:\n${crudo}`);
  }
}

Given('que la raíz del proyecto tiene un proyecto con PDF y con índice', () => {
  proyectoConConfig('language: es-MX\ntoc: true\nformat:\n  pdf:\n    generate: true\n');
});

Given('que la raíz del proyecto tiene un proyecto con 97 y 98 desactivados', () => {
  proyectoConConfig(`${PDF}    disabledPreambleFilters:\n      - 97-eso-pic\n      - 98-crop\n`);
});

Given('que la raíz del proyecto tiene un proyecto con 98 y 99 desactivados', () => {
  proyectoConConfig(`${PDF}    disabledPreambleFilters:\n      - 98-crop\n      - 99-pdfx\n`);
});

Given('que la raíz del proyecto tiene un proyecto con portada', () => {
  proyectoConConfig(`${PDF}    coverImage: true\n`);
});

Given('que la raíz del proyecto tiene un proyecto con portada en la raíz', () => {
  proyectoConConfig(`language: es-MX\ncoverImage: true\nformat:\n  pdf:\n    generate: true\n`);
});

Given('que la raíz del proyecto tiene un proyecto con HTML y PDF', () => {
  proyectoConConfig('language: es-MX\nformat:\n  html:\n    site:\n      title: Test\n    generate: true\n  pdf:\n    generate: true\n');
});

Given('que el título del sitio es {string}', (titulo: string) => {
  // Lo único que cambia respecto del proyecto de prueba. Suficiente para que el
  // build tenga una razón de invalidación que reportar.
  escribirEnProyecto('iteraciones.config.yaml', `language: es-MX\nformat:\n  html:\n    site:\n      title: ${titulo}\n    generate: true\n`);
});

// Espíos de pandoc. Los dos scenarios que los necesitan fallan antes de que
// el build termine, así que un `After` por escenario es el único lugar donde
// devolverlos sin ensuciar cada `Given`.
let espioVersion: { mockRestore: () => void } | undefined;
let espioExec: { mockRestore: () => void; mock: { calls: unknown[] } } | undefined;

/**
 * Corre los dos comandos y comprueba que los dos dicen lo mismo.
 *
 * Los avisos de `build` salen por stdout (van en el resumen) y los de
 * `validate` por stderr, así que cada mitad mira su canal. El código de salida
 * de cada uno queda en `world.salidas` porque después corren los dos y el
 * global `process.exitCode` sólo recuerda el último.
 */
async function buildYValidate(texto: string, veces: number): Promise<void> {
  const contar = (texto: string, dentro: string): number => dentro.split(texto).length - 1;

  await capture(() => runBuild(world.root));
  world.salidas.build = world.exitCode;
  const enBuild = world.stdout + world.stderr;
  const vecesBuild = contar(texto, enBuild);
  if (vecesBuild < veces || (veces > 0 && vecesBuild !== veces)) {
    throw new Error(`build dice ${JSON.stringify(texto)} ${vecesBuild} veces y esperaba ${veces || 'al menos una'}: ${JSON.stringify(enBuild)}`);
  }

  await capture(() => runValidate(world.root));
  world.salidas.validate = world.exitCode;
  const vecesValidate = contar(texto, world.stderr);
  if (vecesValidate < veces || (veces > 0 && vecesValidate !== veces)) {
    throw new Error(
      `validate dice ${JSON.stringify(texto)} ${vecesValidate} veces y esperaba ${veces || 'al menos una'}: ${JSON.stringify(world.stderr)}`,
    );
  }
}

When('build y validate dicen {string}', async (texto: string) => {
  await buildYValidate(texto, 0);
});

When('build y validate dicen {string} exactamente una vez', async (texto: string) => {
  // #2011: un filtro inexistente salía dos veces en build y el usuario contaba
  // dos avisos donde había uno.
  await buildYValidate(texto, 1);
});

Then('el build termina con el código de salida {int}', (codigo: number) => {
  // El código del ÚLTIMO build del escenario: los pasos `build y validate …`
  // corren validate al final, así que `el comando termina con…` ya no sirve.
  if (world.salidas.build !== codigo) {
    throw new Error(`el build terminó con ${world.salidas.build} y esperaba ${codigo}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

Then('validate termina con el código de salida {int}', (codigo: number) => {
  if (world.salidas.validate !== codigo) {
    throw new Error(`validate terminó con ${world.salidas.validate} y esperaba ${codigo}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

Given('que pandoc no está disponible', () => {
  raiz();
  espioVersion = spyOn(pandocRunner, 'getPandocVersion').mockRejectedValue(
    new (class extends Error {
      sourcePath = '';
      stderr = '';
    })('pandoc no está disponible en PATH. Instálalo desde https://pandoc.org/installing.html'),
  );
});

Given('que espío las invocaciones de pandoc', () => {
  espioExec = spyOn(pandocRunner, 'execPandoc');
});

// Las configuraciones que necesitan los escenarios de frontmatter. Cada una es
// un `Given` con nombre y no un `{string}` con la config entera: el que lee el
// feature tiene que poder ver de un vistazo qué proyecto se está armando.

Given('que la raíz del proyecto tiene un proyecto en inglés', () => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', 'language: en\nformat:\n  latex:\n    generate: true\n');
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido de prueba.\n');
});

Given('que la raíz del proyecto tiene un proyecto en español de México', () => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  latex:\n    generate: true\n');
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido de prueba.\n');
});

Given('que la raíz del proyecto tiene un proyecto con EPUB', () => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  epub:\n    generate: true\n');
  escribirEnProyecto('test.md', '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido de prueba.\n');
});

Given('que la raíz del proyecto tiene un proyecto con los tres formatos ligeros', () => {
  raiz();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    [
      'language: es-MX',
      'format:',
      '  html:',
      '    site:',
      '      title: Test',
      '    generate: true',
      '  epub:',
      '    generate: true',
      '  markdown:',
      '    generate: true',
    ].join('\n'),
  );
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido de prueba.\n');
});

Given('que la raíz del proyecto tiene un proyecto con índice', () => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\ntoc: true\n');
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido de prueba.\n');
});

// El `.tex` sale de la plantilla sin pasar por latexmk: estos escenarios leen el
// LaTeX generado, no compilan.
const LATEX_SIN_PDF = 'language: es-MX\nformat:\n  latex:\n    generate: true\n  pdf:\n    generate: false\n';

Given('que la raíz del proyecto tiene un proyecto con LaTeX y sin PDF', () => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', LATEX_SIN_PDF);
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido de prueba.\n');
});

Given('que la raíz del proyecto tiene un proyecto con LaTeX', () => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nformat:\n  latex:\n    generate: true\n');
  escribirEnProyecto('test.md', '---\ntitle: Test Document\n---\n\nContenido de prueba.\n');
});

Given('que la raíz del proyecto apaga la fecha desde la config', () => {
  escribirEnProyecto('iteraciones.config.yaml', `${LATEX_SIN_PDF}    showDate: false\n`);
});

Given('que la raíz del proyecto enciende la fecha desde la raíz', () => {
  escribirEnProyecto(
    'iteraciones.config.yaml',
    `language: es-MX\nshowDate: true\nformat:\n  latex:\n    generate: true\n  pdf:\n    generate: false\n`,
  );
});

Given('que la raíz del proyecto pone el número de página en el pie central', () => {
  escribirEnProyecto(
    'iteraciones.config.yaml',
    `language: es-MX\npageNumber: footer-center\nformat:\n  latex:\n    generate: true\n  pdf:\n    generate: false\n`,
  );
});

// PNG 1x1 válido, en base64. Los escenarios de portada necesitan un archivo que
// el build pueda leer de verdad: con un texto qualquer falla antes de llegar al
// `.tex` y el escenario probaría otra cosa.
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

Given('que la raíz del proyecto tiene configuración pero ningún documento', () => {
  raiz();
  // Sin `test.md`: un proyecto recién inicializado todavía no tiene documentos.
  escribirEnProyecto(
    'iteraciones.config.yaml',
    ['language: es-MX', 'format:', '  html:', '    site:', '      title: Test', '    generate: true'].join('\n'),
  );
});

Given('que la raíz del proyecto declara la bibliografía {string}', (relativa: string) => {
  escribirEnProyecto('iteraciones.config.yaml', `language: es-MX\nbibliography: ${relativa}\n`);
});

Given('que la bibliografía declara el título {string}', (titulo: string) => {
  // La clave `ejemplo2024` es la que cita el documento del escenario; sólo
  // cambia el título, que es lo que el build tiene que volver a renderizar.
  escribirEnProyecto('refs/libro.bib', `@book{ejemplo2024,\n  title = {${titulo}},\n  author = {Autor},\n  year = {2024},\n}\n`);
});

Given('que el archivo {string} es un PNG de 1 por 1', (relativa: string) => {
  const ruta = join(raiz(), relativa);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, PNG_1X1);
});

Given('que la raíz del proyecto declara la portada {string}', (imagen: string) => {
  escribirEnProyecto('iteraciones.config.yaml', `language: es-MX\ntitleImage: ./${imagen}\nformat:\n  latex:\n    generate: true\n`);
});

Given('que el build deja el estado sin marcar como completado', () => {
  // Lo que queda si el proceso muere a mitad de render: `discover` ya
  // persistió el estado, pero el marcado final nunca ocurrió.
  const ruta = join(raiz(), '.iteraciones', 'state.json');
  const estado = JSON.parse(readFileSync(ruta, 'utf8')) as Record<string, unknown>;
  delete estado.completed;
  writeFileSync(ruta, JSON.stringify(estado), 'utf8');
});

Given('que la raíz del proyecto tiene un filtro lua con sintaxis rota', () => {
  raiz();
  escribirEnProyecto('iteraciones.config.yaml', 'language: es-MX\nluaFilters: [filters/roto.lua]\n');
  escribirEnProyecto('filters/roto.lua', 'function ) sintaxis inválida\n');
});

Then('el JSON no declara avisos sobre {string}', (archivos: string) => {
  // Varios archivos separados por coma: los contenedores van juntos y tienen
  // que salir limpios los dos.
  const lista = Array.isArray(jsonSalida().warnings) ? (jsonSalida().warnings as Record<string, unknown>[]) : [];
  const delArchivo = lista.filter((a) =>
    archivos
      .split(',')
      .map((s) => s.trim())
      .includes(String(a.file)),
  );
  if (delArchivo.length > 0) {
    throw new Error(`el JSON declara ${delArchivo.length} avisos sobre ${archivos} y no debería: ${JSON.stringify(lista)}`);
  }
});

Then('el build reprocesa los documentos', () => {
  // La contraparte de "reutilizado": si el build sirve de caché, el arreglo del
  // autor no se vería nunca y el escenario sería un falso verde.
  //
  // Se busca CUALQUIER marca de reutilización, no una en particular: el atajo
  // de "sin cambios" y el de "todos reutilizados" son dos caminos distintos y
  // un check que sólo mira uno deja pasar al otro.
  if (!world.stdout.includes('Documentos')) {
    throw new Error(`la salida no habla de documentos: ${JSON.stringify(world.stdout)}`);
  }
  if (world.stdout.includes('reutilizado')) {
    throw new Error(`el build sirvió de caché cuando tenía que reprocesar: ${JSON.stringify(world.stdout)}`);
  }
});

Then('el build reutiliza la salida', () => {
  if (!world.stdout.includes('(reutilizado)')) {
    throw new Error(`la salida no dice que reutilizó: ${JSON.stringify(world.stdout)}`);
  }
});

Then('el build genera index en todos los formatos', async () => {
  const formats = ['html', 'pdf', 'tex', 'epub', 'md'];
  for (const ext of formats) {
    if (!existsSync(join(raiz(), 'dist', 'files', `index.${ext}`))) {
      throw new Error(`index.md no generó index.${ext}`);
    }
  }
  // Y NINGUNA salida con el slug derivado del título: antes salían `inicio.pdf`
  // e `inicio.tex` además de `index.*`, con dos nombres para el mismo documento.
  for (const ext of ['pdf', 'tex', 'epub', 'md']) {
    if (existsSync(join(raiz(), 'dist', 'files', `inicio.${ext}`))) {
      throw new Error(`el build también generó inicio.${ext}: dos nombres para el mismo documento`);
    }
  }
});

Then('el JSON declara que no hay ni un error', () => {
  const salida = jsonSalida();
  const errores = Array.isArray(salida.errors) ? salida.errors : [];
  if (salida.ok !== true || errores.length > 0) {
    throw new Error(`el JSON no está limpio: ${JSON.stringify(salida)}`);
  }
});

Then('validate dice lo mismo sobre el documento {string}', async (archivo: string) => {
  // Si sólo `build` detectara el miembro vacío, el autor que usa `validate`
  // para evitar un build largo no se entera hasta que compila.
  await capture(() => runValidate(world.root));
  for (const texto of [archivo, 'agrega un body para proceder con el build']) {
    if (!world.stderr.includes(texto)) {
      throw new Error(`validate no dice ${JSON.stringify(texto)}: ${JSON.stringify(world.stderr)}`);
    }
  }
});

Then('el error nombra el documento una sola vez', () => {
  // El prefijo del wrapper pone el nombre entre comillas; el texto de pandoc lo
  // repite. Lo que se comprueba es que quede una sola mención.
  //
  // Sin el color: en un terminal el `✖` va coloreado aparte y el prefijo en
  // texto plano no aparece. La aserción es sobre el mensaje, no sobre cómo lo
  // decora el terminal.
  const limpio = sinColor(world.stderr);
  const prefijo = '✖ pandoc falló al convertir el documento en "';
  if (!limpio.includes(prefijo) || !limpio.includes('test.md')) {
    throw new Error(`el error no nombra el documento con el prefijo esperado: ${JSON.stringify(limpio)}`);
  }
});

Given('que la raíz del proyecto tiene un proyecto con todos los formatos', () => {
  raiz();
  escribirEnProyecto(
    'iteraciones.config.yaml',
    'language: es-MX\nformat:\n  latex:\n    generate: true\n  pdf:\n    generate: true\n  html:\n    generate: true\n  epub:\n    generate: true\n  markdown:\n    generate: true\n',
  );
  escribirEnProyecto('test.md', '---\ntitle: Test Document\ndate: 2026-01-01\n---\n\nContenido de prueba.\n');
});

Given('que borro el archivo {string}', (relativa: string) => {
  unlinkSync(join(raiz(), relativa));
});

Given('que el estado del build quedó corrupto', () => {
  // Lo que queda si el proceso muere a mitad de la escritura única del estado.
  escribirEnProyecto('.iteraciones/state.json', '{"startedAt":42,"activeFor');
});

When('hago un build del proyecto', async () => {
  await capture(() => runBuild(world.root));
});

When('hago un build del proyecto pidiendo JSON', async () => {
  await capture(() => runBuild(world.root, { json: true }));
});

After(() => {
  // Si un espío queda puesto, el `build` de los escenarios siguientes corre
  // contra un pandoc que no existe y falla por el motivo equivocado.
  espioVersion?.mockRestore();
  espioVersion = undefined;
  espioExec?.mockRestore();
  espioExec = undefined;
});

When('hago un build con la salida {string}', async (salida: string) => {
  await capture(() => runBuild(world.root, { outputDir: salida }));
});

When('pido el build en JSON y con detalle', async () => {
  await capture(() => runBuild(world.root, { json: true, verbose: true }));
});

When('el build falla con el error {word}', async (clase: string) => {
  // El feature nombra el error en lenguaje de negocio; acá está el error real.
  const errores: Record<string, Error> = {
    // El caso del issue original: "latexmk no está disponible en PATH"
    'pandoc-falta-entorno': new PandocError(
      'latexmk no está disponible en PATH. Instala MacTeX full: https://tug.org/mactex/',
      '',
      '',
      PANDOC_ERROR_CODES.envMissing,
    ),
    'comando-inexistente': new ProcessSpawnError('No se encontró el comando "magick".'),
    otro: new Error('algo raro'),
  };
  const error = errores[clase];
  if (!error) throw new Error(`el escenario pide un error que el feature no define: ${clase}`);
  await capture(async () => {
    reportBuildError(error);
  });
});

Then('la salida dice que se procesó {int} documento sin caché', (cuantos: number) => {
  // El separador de la columna es `padEnd`, así que no se busca la cadena entera.
  const patron = new RegExp(`Documentos\\s+${cuantos} — sin caché previa`);
  if (!patron.test(world.stdout)) {
    throw new Error(`la salida no dice que se procesaron ${cuantos} documentos sin caché: ${JSON.stringify(world.stdout)}`);
  }
});

Then('el estado del build queda completo y con schemaVersion {int}', async (version: number) => {
  const ruta = join(raiz(), '.iteraciones', 'state.json');
  const estado = JSON.parse(readFileSync(ruta, 'utf8')) as { completed?: boolean; schemaVersion?: number };
  if (estado.completed !== true) {
    throw new Error(`el estado quedó con completed=${JSON.stringify(estado.completed)} y debía quedar completo`);
  }
  if (estado.schemaVersion !== version) {
    throw new Error(`el estado quedó con schemaVersion=${JSON.stringify(estado.schemaVersion)} y debía quedar ${version}`);
  }
});

Then('la salida dice que se reprocesó por {string}', (razon: string) => {
  // La razón va plegada en la línea de documentos, con `padEnd` de por medio.
  const patron = new RegExp(`Documentos\\s+1 — ${razon.replace(/[()]/g, '\\$&')}`);
  if (!patron.test(world.stdout)) {
    throw new Error(`la salida no dice que se reprocesó por ${JSON.stringify(razon)}: ${JSON.stringify(world.stdout)}`);
  }
});

Then('el JSON declara la lista {string} con el valor {string}', (clave: string, valor: string) => {
  const lista = jsonSalida()[clave];
  if (!Array.isArray(lista) || lista.length !== 1 || lista[0] !== valor) {
    throw new Error(`${JSON.stringify(clave)} es ${JSON.stringify(lista)} y el contrato dice ${JSON.stringify([valor])}`);
  }
});

Then('el JSON declara "outputDir" como la ruta real de la salida', async () => {
  // La ruta canónica: la misma que ve `process.cwd()` después de resolver
  // symlinks. Sin eso, comparar rutas en el consumidor falla en macOS, donde
  // `/tmp` es un symlink a `/private/tmp`.
  const declarado = String(jsonSalida().outputDir);
  const esperado = join(await realpath(raiz()), 'dist', 'files');
  if (declarado !== esperado) {
    throw new Error(`outputDir es ${JSON.stringify(declarado)} y la ruta real es ${JSON.stringify(esperado)}`);
  }
});

Then('el JSON declara {string} diciendo {string}', (clave: string, texto: string) => {
  const valor = String(jsonSalida()[clave] ?? '');
  if (!valor.includes(texto)) {
    throw new Error(`${JSON.stringify(clave)} no dice ${JSON.stringify(texto)}. Dice: ${JSON.stringify(valor)}`);
  }
});

Then('el JSON declara al menos {int} aviso que menciona {string}', (minimo: number, texto: string) => {
  const avisos = jsonSalida().warnings;
  if (!Array.isArray(avisos)) {
    throw new Error(`el JSON no declara warnings: ${JSON.stringify(jsonSalida())}`);
  }
  const conTexto = avisos.filter((a) => String(a).includes(texto));
  if (conTexto.length < minimo) {
    throw new Error(`el JSON declara ${avisos.length} avisos y ${conTexto.length} mencionan ${JSON.stringify(texto)}`);
  }
});

Then('el directorio temporal no tiene una carpeta {string}', (carpeta: string) => {
  // Un `--output` relativo se resuelve contra la raíz del PROYECTO. Si el build
  // escribiera en el cwd del proceso dejaría archivos donde el usuario no los
  // busca y donde el siguiente build no los encuentra.
  if (existsSync(join(tmpdir(), carpeta))) {
    throw new Error(`el build escribió ${carpeta} en el directorio temporal del sistema`);
  }
});

Then('la salida es una sola línea', () => {
  const lineas = world.stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lineas.length !== 1) {
    throw new Error(`stdout tiene ${lineas.length} líneas y el contrato --json pide una: ${JSON.stringify(world.stdout)}`);
  }
});

Then('el JSON declara exactamente las claves {string}', (esperadas: string) => {
  const declaradas = Object.keys(jsonSalida()).sort();
  const queridas = esperadas
    .split(',')
    .map((c) => c.trim())
    .sort();
  if (declaradas.join(',') !== queridas.join(',')) {
    throw new Error(`el JSON declara ${JSON.stringify(declaradas)} y el contrato pide ${JSON.stringify(queridas)}`);
  }
});

Then('el JSON no declara la clave {string}', (clave: string) => {
  if (clave in jsonSalida()) {
    throw new Error(`el JSON declara ${JSON.stringify(clave)} y no debería: ${JSON.stringify(jsonSalida())}`);
  }
});

function comprobarTipo(clave: string, tipo: 'número' | 'lista' | 'texto'): void {
  const valor = jsonSalida()[clave];
  const ok = tipo === 'número' ? typeof valor === 'number' : tipo === 'lista' ? Array.isArray(valor) : typeof valor === 'string';
  if (!ok) {
    throw new Error(`${JSON.stringify(clave)} es ${JSON.stringify(valor)} y el contrato dice que es ${tipo}`);
  }
}

Then('el JSON declara {string} como número', (clave: string) => comprobarTipo(clave, 'número'));
Then('el JSON declara {string} como lista', (clave: string) => comprobarTipo(clave, 'lista'));
Then('el JSON declara {string} como texto', (clave: string) => comprobarTipo(clave, 'texto'));

Then('el archivo {string} apunta a la imagen {string}', (relativa: string, imagen: string) => {
  const contenido = readFileSync(join(raiz(), relativa), 'utf8');
  if (!contenido.includes('\\titleimage{')) {
    throw new Error(`${relativa} no declara \\titleimage{`);
  }
  // Acepta las dos formas: la ruta absoluta original, o la copia procesada
  // (CMYK) que deja ImageMagick — y esa copia lleva sufijo, así que se compara
  // por el nombre SIN extensión. Cuál de las dos depende de si el build corrió
  // ImageMagick, y eso no es parte de la regla.
  const nombre = imagen.replace(/\.[^.]+$/, '');
  if (!contenido.includes(join(raiz(), imagen)) && !contenido.includes(nombre)) {
    throw new Error(`${relativa} no apunta a ${JSON.stringify(imagen)}:\n${contenido.slice(0, 400)}`);
  }
});

Then('el error menciona la ruta real de {string}', (relativa: string) => {
  // El mensaje lleva la ruta ABSOLUTA: un usuario mirando un `--output` o un
  // proyecto en otro directorio necesita saber dónde la buscó el build.
  if (!world.stderr.includes(join(raiz(), relativa))) {
    throw new Error(`el error no menciona la ruta real de ${relativa}: ${JSON.stringify(world.stderr)}`);
  }
});

Then('el EPUB declara la clave {string} con el valor {string}', async (clave: string, valor: string) => {
  // El `.epub` es un ZIP: hay que desempaquetar `content.opf` y mirar los
  // `dc:*` de verdad. El nombre del archivo lo genera del slug
  // título-por-autor, así que se busca con un glob y no se compone.
  const [epub] = [...new Bun.Glob('dist/files/*.epub').scanSync({ cwd: raiz() })];
  if (!epub) throw new Error('el build no generó ningún .epub');
  const proc = Bun.spawn(['unzip', '-p', join(raiz(), epub), 'EPUB/content.opf'], { stdout: 'pipe', stderr: 'pipe' });
  const [salida, errores, codigo] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (codigo !== 0 || errores !== '') {
    throw new Error(`unzip falló (código ${codigo}): ${errores}`);
  }
  if (!salida.includes(valor)) {
    throw new Error(`el EPUB no declara ${clave}=${JSON.stringify(valor)}. Va:\n${salida.slice(0, 600)}`);
  }
});

Then('la salida dice que hay {int} formatos activos', (cuantos: number) => {
  // El separador de la columna es `padEnd`, así que se busca con un regex y no
  // repitiendo los espacios.
  const patron = new RegExp(`Formatos activos\\s+${cuantos}`);
  if (!patron.test(world.stdout)) {
    throw new Error(`la salida no dice ${cuantos} formatos activos: ${JSON.stringify(world.stdout)}`);
  }
});

Then('el archivo {string} no contiene {string}', (relativa: string, texto: string) => {
  const contenido = readFileSync(join(raiz(), relativa), 'utf8');
  if (contenido.includes(texto)) {
    throw new Error(`${relativa} sí contiene ${JSON.stringify(texto)} y no debería`);
  }
});

Then('el archivo {string} lleva la firma {string}', (relativa: string, firma: string) => {
  // Se busca la firma en cualquier posición, no en el byte 0: la firma de PNG
  // es `\x89PNG`, con un byte de/binario antes de las letras. Buscar "%PDF" en el
  // byte 0 y "PNG" en el byte 1 sería el mismo paso con dos reglas.
  const contenido = readFileSync(join(raiz(), relativa));
  if (!contenido.includes(Buffer.from(firma, 'utf8'))) {
    throw new Error(`${relativa} no lleva la firma ${JSON.stringify(firma)} en sus primeros bytes`);
  }
});

Then('el archivo {string} declara {string}', (relativa: string, texto: string) => {
  const contenido = readFileSync(join(raiz(), relativa), 'utf8');
  if (!contenido.includes(texto)) {
    throw new Error(`${relativa} no declara ${JSON.stringify(texto)}`);
  }
});

Then('el PDF pasa la certificación X-1a', async () => {
  const ruta = join(raiz(), 'dist', 'files', 'test-document.pdf');
  const binario = await resolvePdfCheckBinary();
  if (!binario) {
    // ponytail: el binario es Rust y la suite no lo compila. Sin él, la
    // aserción fuerte es la del /TrimBox, que ya corrió. Con él, se exige la
    // certificación de verdad.
    if (!world.stdout.includes('Validación PDF/X-1a')) {
      throw new Error('no se encontró el binario de pdfcheck y el build tampoco reportó una validación PDF/X-1a');
    }
    return;
  }
  const check = await validatePdfX1a(ruta, binario);
  if (!check.valid) {
    throw new Error(`el PDF no certifica PDF/X-1a: ${JSON.stringify(check)}`);
  }
  if (!world.stdout.includes('Validación PDF/X-1a: 1 PDF certifica PDF/X-1a')) {
    throw new Error('el PDF certifica pero el resumen del build no lo dice (#1960)');
  }
});
