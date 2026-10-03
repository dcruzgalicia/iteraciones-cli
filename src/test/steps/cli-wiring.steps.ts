import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { runBuild, runClean, runValidate } from '../../cli/dispatcher.js';
import { buildProgram } from '../../cli/parser.js';
import { capture, tempRoot, world } from './cli-world.steps.js';

/**
 * #2546 (onda 2) — tranche 5 de `cli-layer`: el wiring por argv, `clean` e `init`.
 *
 * ## El riesgo de este bloque es otro
 *
 * Los tests de `runBuild` llaman `runBuild(dir, { full: true })` directo. Nadie
 * prueba que `iteraciones build --full` llegue a `runBuild` con `{ full: true }`.
 * Un flag mal cableado en el parser no rompe ningún test del dispatcher: rompe
 * el comando. Por eso la mitad de los pasos de acá corren por `parseAsync` con
 * argv de verdad.
 *
 * ## `capture` es lo que hace posible el `--json`
 *
 * Los pasos que esperan JSON necesitan `stdout` intacto. `capture()` espía los
 * dos streams, corre el comando y deja todo en el mundo. El `Then` de JSON ya
 * vive en `cli-validate.steps.ts` y se comparte: el formato de `validate --json`
 * y el de `clean --json` son el mismo contrato.
 */

/**
 * Parte el argv del feature respetando comillas: `--title "Título CLI"` son dos
 * argumentos, no tres. Sin esto, cualquier valor con espacio rompe el comando y
 * el error que sale es el de commander, no el del flag mal cableado.
 */
function partir(argv: string): string[] {
  const partes: string[] = [];
  let actual = '';
  let dentro = false;
  for (const letra of argv) {
    if (letra === '"') dentro = !dentro;
    else if (letra === ' ' && !dentro) {
      if (actual) partes.push(actual);
      actual = '';
    } else actual += letra;
  }
  if (actual) partes.push(actual);
  return partes;
}

function ruta(relativa: string): string {
  return join(world.root, relativa);
}

function escribir(relativa: string, contenido: string): void {
  writeFileSync(ruta(relativa), contenido, 'utf8');
}

function mkdir(relativa: string): void {
  mkdirSync(ruta(relativa), { recursive: true });
}

/** El `JSON.parse` de `stdout`. Mismo contrato que el de `validate --json`. */
function jsonSalida(): Record<string, unknown> {
  const crudo = world.stdout.trim();
  try {
    return JSON.parse(crudo) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`stdout no es JSON válido: ${(err as Error).message}\nva:\n${crudo}`);
  }
}

Given('que la raíz del proyecto no existe todavía', () => {
  world.root = join(tempRoot('iteraciones-cli-'), 'raiz-que-no-existe');
});

Given('que el directorio {string} existe', (relativa: string) => {
  mkdir(relativa);
});

Given('que hay un build previo en la raíz del proyecto', () => {
  mkdir('dist/files');
  mkdir('.iteraciones/ast');
  escribir('dist/files/x.html', 'x');
});

Given('que el directorio {string} no tiene permisos', async (relativa: string) => {
  mkdir(relativa);
  escribir(`${relativa}/x.txt`, 'x');
  // Await: sin esto el `chmod` corre en paralelo a `clean` y el escenario pasa
  // porque el directorio todavía era borrable.
  await Bun.$`chmod 000 ${ruta(relativa)}`.quiet();
});

Given('que el estado del build declara la salida {string}', (salida: string) => {
  // El estado que escribe un build previo con `--output <salida>`. `clean` lo
  // lee para saber qué borrar: si mirara sólo `dist/`, la salida de siempre
  // sobreviviría al clean (#2183).
  mkdir('.iteraciones');
  escribir(
    '.iteraciones/state.json',
    JSON.stringify({
      schemaVersion: 2,
      startedAt: 1,
      completed: true,
      activeFormats: ['html'],
      entries: {},
      outputDir: ruta(salida),
    }),
  );
});

When('parseo el comando {string} sobre la raíz del proyecto', async (argv: string) => {
  await capture(async () => {
    try {
      await buildProgram().parseAsync(['bun', 'bin.ts', ...partir(argv), '--project-root', world.root]);
    } catch (err) {
      // `exitOverride` lanza en los errores de uso y también tras mostrar el
      // help. Este camino no pasa por `process.exitCode`, así que el `catch` lo
      // repone para que `capture()` siga teniendo un solo lugar del que leer.
      process.exitCode = (err as { exitCode?: number }).exitCode ?? 1;
    }
  });
});

When('parseo el comando {string}', async (argv: string) => {
  await capture(async () => {
    try {
      await buildProgram().parseAsync(['bun', 'bin.ts', ...partir(argv)]);
    } catch (err) {
      process.exitCode = (err as { exitCode?: number }).exitCode ?? 1;
    }
  });
});

When('corro "clean" pidiendo JSON', async () => {
  await capture(() => runClean(world.root, { json: true }));
});

When('construyo el proyecto en limpio', async () => {
  await capture(() => runBuild(world.root, { full: true }));
});

When('construyo el proyecto en limpio y con detalle', async () => {
  await capture(() => runBuild(world.root, { full: true, verbose: true }));
});

When('compilo el proyecto recién creado', async () => {
  await capture(() => build(world.root, {}));
});

When('devuelvo los permisos de {string}', async (relativa: string) => {
  // Sin esto el `After` compartido no puede borrar el temporal, porque `rm`
  // necesita entrar al directorio para vaciarlo.
  await Bun.$`chmod 700 ${ruta(relativa)}`.quiet();
});

Then('el proyecto recién creado pasa validate', async () => {
  await capture(() => runValidate(world.root));
});

Then('la salida de error no lleva ningún error', () => {
  if (world.stderr.includes('✖')) {
    throw new Error(`validate del proyecto recién creado se llevó un error: ${JSON.stringify(world.stderr)}`);
  }
});

// Sincrono por el docstring: ver la nota de cucumber-js en `cli-world.steps.ts`.
Then('el archivo {string} quedó con este contenido', (relativa: string, contenido: string) => {
  const actual = readFileSync(ruta(relativa), 'utf8');
  if (actual !== contenido) {
    throw new Error(`${relativa} debería quedar intacto. Va:\n${JSON.stringify(actual)} y esperaba ${JSON.stringify(contenido)}`);
  }
});

Then('el directorio {string} no existe', (relativa: string) => {
  if (existsSync(ruta(relativa))) {
    throw new Error(`${relativa} no debería existir en ${world.root}`);
  }
});

Then('el directorio {string} tiene al menos {int} archivo .html', async (relativa: string, minimo: number) => {
  const archivos = (await readdir(ruta(relativa))).filter((f) => f.endsWith('.html'));
  if (archivos.length < minimo) {
    throw new Error(`${relativa} tiene ${archivos.length} archivos .html y esperaba al menos ${minimo}`);
  }
});

Then('el archivo {string} tiene como máximo {int} líneas', (relativa: string, maximo: number) => {
  const lineas = readFileSync(ruta(relativa), 'utf8').split('\n').length;
  if (lineas > maximo) {
    throw new Error(`${relativa} tiene ${lineas} líneas y el máximo es ${maximo}. Va:\n${readFileSync(ruta(relativa), 'utf8')}`);
  }
});

Then('el config del proyecto no declara {string}', (clave: string) => {
  // Los defaults viven en el código. Un `blocks` escrito en el config del
  // proyecto se vuelve la configuración para siempre y deja de actualizarse con
  // el CLI.
  const yaml = Bun.YAML.parse(readFileSync(ruta('iteraciones.config.yaml'), 'utf8')) as Record<string, unknown>;
  const html = (yaml.format as Record<string, Record<string, unknown>> | undefined)?.html;
  if (html && clave in html) {
    throw new Error(`el config declara ${JSON.stringify(clave)} y los defaults deberían vivir en el código`);
  }
});

Then('el JSON declara al menos {int} rutas eliminadas', (minimo: number) => {
  const removed = jsonSalida().removed;
  if (!Array.isArray(removed) || removed.length < minimo) {
    throw new Error(`el JSON declara ${JSON.stringify(removed)} y esperaba al menos ${minimo} rutas`);
  }
});

Then('el JSON declara la lista {string} vacía', (clave: string) => {
  const valor = jsonSalida()[clave];
  if (!Array.isArray(valor) || valor.length > 0) {
    throw new Error(`el JSON declara ${JSON.stringify(clave)}=${JSON.stringify(valor)} y esperaba una lista vacía`);
  }
});

Then('el JSON no declara fallos', () => {
  const failures = jsonSalida().failures;
  if (!Array.isArray(failures) || failures.length > 0) {
    throw new Error(`el JSON declara failures=${JSON.stringify(failures)} y esperaba una lista vacía`);
  }
});
