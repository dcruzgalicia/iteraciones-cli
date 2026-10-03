import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { resolvePdfCheckBinary, validatePdfX1a } from '../../builder/pdfx-check.js';
import { reportBuildError, runBuild } from '../../cli/dispatcher.js';
import { PANDOC_ERROR_CODES, PandocError } from '../../lib/errors.js';
import { ProcessSpawnError } from '../../lib/run.js';
import { capture, escribirEnProyecto, tempRoot, world } from './cli-world.steps.js';

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
