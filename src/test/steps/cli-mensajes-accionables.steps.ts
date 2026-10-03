import { spyOn } from 'bun:test';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { After, Given, Then, When } from '@cucumber/cucumber';
import { CommanderError } from 'commander';
import { runBuild, runClean, runDoctor, runFilters, runInit, runNew, runValidate } from '../../cli/dispatcher.js';
import { checkReadPermissions, checkWritePermissions } from '../../cli/doctor/system-checks.js';
import { buildProgram } from '../../cli/parser.js';

/**
 * #2546 (onda 2) — tranche 2 de `cli-layer`: los mensajes accionables.
 *
 * ## Por qué este bloque y no `runBuild`
 *
 * `runBuild` es el bloque más grande del archivo (72 casos, 1.644 líneas) y el
 * más caro: cada caso monta un proyecto distinto y comprueba algo distinto,
 * sobre el builder real. No es una tabla y no se reduce sin reescribirlo.
 *
 * Este bloque sí es una tabla: el mismo "corré el CLI y mirá lo que dice", con
 * la entrada variando. 22 casos de golpe y con la misma forma.
 *
 * ## El parser: `parseAsync` a veces lanza y a veces no
 *
 * Los errores de commander llegan por dos caminos distintos:
 *
 * - errores de **uso** (`comando desconocido`, `opción desconocida`) → lanza
 *   `CommanderError` y el texto va por **stderr**;
 * - `--help` y `build --help` → también lanza `CommanderError`, pero el texto va
 *   por **stdout**, porque es ayuda y no un error.
 *
 * Por eso este archivo espía los dos streams y nunca asume cuál va a hablar.
 * El original repetía ese `try/finally` en cada `it`; aquí está una vez.
 *
 * ## Un solo código de salida para el `Then`
 *
 * El original mezclaba dos fuentes: los casos del parser leían el `exitCode`
 * del `CommanderError` capturado, y los del dispatcher leían
 * `process.exitCode`. Son dos cosas distintas y el `Given`/`When` de este
 * archivo no le dice al `Then` de dónde sacarla. Los dos helpers la escriben en
 * el mismo sitio (`world.exitCode`) y el `Then` lee una sola cosa.
 */

interface Output {
  stdout: string;
  stderr: string;
}

interface Check {
  ok: boolean;
  /** `CheckResult.detail` es opcional: un check que pasa a veces no lo trae. */
  detail?: string;
}

const world = {
  output: { stdout: '', stderr: '' } as Output,
  exitCode: 0,
  root: '',
  read: { ok: true, detail: '' } as Check,
  write: { ok: true, detail: '' } as Check,
};

/** Corre el parser y captura los dos streams y el código de salida. */
async function parse(argv: string): Promise<void> {
  const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
  world.output = { stdout: '', stderr: '' };
  world.exitCode = 0;
  process.exitCode = 0;
  try {
    await buildProgram().parseAsync(['bun', 'bin.ts', ...argv.split(' ').filter(Boolean)]);
    // No todos los rechazos de uso llegan como excepción: la validación de
    // `--output`, por ejemplo, corre en un hook del programa que sólo escribe
    // el mensaje y pone `process.exitCode`. Ese camino no lanza nada, así que
    // hay que leer el global o el exit code se queda en 0.
    world.exitCode = process.exitCode ?? 0;
  } catch (err) {
    // `exitOverride` lanza en los errores de uso y también tras mostrar el help.
    world.exitCode = err instanceof CommanderError ? err.exitCode : 1;
  } finally {
    world.output.stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    world.output.stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

/** Corre un comando del dispatcher contra `world.root` y captura stderr. */
async function dispatch(command: string): Promise<void> {
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
  world.output = { stdout: '', stderr: '' };
  try {
    process.exitCode = 0;
    const commands: Record<string, (root: string) => Promise<unknown>> = {
      build: runBuild,
      validate: runValidate,
      doctor: runDoctor,
      new: (root) => runNew(root, 'doc.md'),
      clean: runClean,
      'list-filters': runFilters,
      init: runInit,
    };
    const run = commands[command];
    if (!run) throw new Error(`el escenario pide un comando que el dispatcher no tiene: ${command}`);
    await run(world.root);
    world.exitCode = process.exitCode ?? 0;
  } finally {
    world.output.stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    stderrSpy.mockRestore();
  }
}

After(async () => {
  process.exitCode = 0;
  world.output = { stdout: '', stderr: '' };
  world.exitCode = 0;
  if (world.root) await rm(world.root, { recursive: true, force: true });
  world.root = '';
});

Given('que la raíz del proyecto no existe', () => {
  // `tmpdir()` + pid + reloj: dos corridas no colisionan y el `After` puede
  // borrar lo que haga falta sin tener que saber el nombre.
  world.root = join(tmpdir(), `no-existe-${process.pid}-${Date.now()}`);
});

When('parseo el argv {string}', async (argv: string) => {
  await parse(argv);
});

When('corro {string}', async (comando: string) => {
  await dispatch(comando);
});

When('reviso los permisos de lectura y escritura', async () => {
  world.read = await checkReadPermissions(world.root);
  world.write = await checkWritePermissions(world.root);
});

Then('el error dice {string}', (esperado: string) => {
  if (!world.output.stderr.includes(esperado)) {
    throw new Error(`el error no dice ${JSON.stringify(esperado)}. stderr: ${JSON.stringify(world.output.stderr)}`);
  }
});

Then('el error no dice {string}', (ruido: string) => {
  if (world.output.stderr.includes(ruido)) {
    throw new Error(`el error sí dice ${JSON.stringify(ruido)} y no debería: ${JSON.stringify(world.output.stderr)}`);
  }
});

Then('el error sugiere el comando {string}', (sugerido: string) => {
  const esperado = `(¿Quisiste decir ${sugerido}?)`;
  if (!world.output.stderr.includes(esperado)) {
    throw new Error(`el error no sugiere ${JSON.stringify(esperado)}. stderr: ${JSON.stringify(world.output.stderr)}`);
  }
});

Then('el error no muestra un stack trace', () => {
  // `at <anonymous>` es la firma de un stack sin manejar. El mensaje tiene que
  // ser legible por una persona, no por un depurador.
  if (world.output.stderr.includes('at <anonymous>')) {
    throw new Error(`el error sí trae un stack trace: ${JSON.stringify(world.output.stderr)}`);
  }
});

Then('el error dice que la ruta no existe', () => {
  if (!world.output.stderr.includes('no existe')) {
    throw new Error(`el error no dice que la ruta no existe: ${JSON.stringify(world.output.stderr)}`);
  }
});

Then('el comando termina con el código de salida {int}', (codigo: number) => {
  if (world.exitCode !== codigo) {
    throw new Error(`esperaba código de salida ${codigo} y hubo ${world.exitCode}. stderr: ${JSON.stringify(world.output.stderr)}`);
  }
});

Then('la ayuda contiene {string}', (esperado: string) => {
  if (!world.output.stdout.includes(esperado)) {
    throw new Error(`la ayuda no contiene ${JSON.stringify(esperado)}. stdout: ${JSON.stringify(world.output.stdout)}`);
  }
});

Then('la ayuda no muestra {string}', (ingles: string) => {
  if (world.output.stdout.includes(ingles)) {
    throw new Error(`la ayuda sí muestra el inglés ${JSON.stringify(ingles)}`);
  }
});

Then('la ayuda repite {string} una sola vez', (texto: string) => {
  const veces = world.output.stdout.split(texto).length - 1;
  if (veces !== 1) {
    throw new Error(`esperaba ${JSON.stringify(texto)} una vez y apareció ${veces} veces`);
  }
});

Then('la ayuda empieza con el slogan', () => {
  if (!world.output.stdout.startsWith('escribir, compartir, re-existir')) {
    throw new Error(`la ayuda no empieza con el slogan: ${JSON.stringify(world.output.stdout.slice(0, 80))}`);
  }
});

Then('ambos checks fallan', () => {
  if (world.read.ok || world.write.ok) {
    throw new Error('los checks de permisos deberían fallar sobre una raíz inexistente');
  }
});

Then('ambos detalles dicen que la ruta no existe', () => {
  for (const [nombre, check] of [
    ['lectura', world.read],
    ['escritura', world.write],
  ] as const) {
    if (!(check.detail ?? '').includes('no existe')) {
      throw new Error(`el check de ${nombre} no dice que la ruta no existe: ${JSON.stringify(check.detail)}`);
    }
  }
});

Then('existe el archivo de configuración del proyecto', async () => {
  const config = join(world.root, 'iteraciones.config.yaml');
  if (!(await Bun.file(config).exists())) {
    throw new Error(`init no creó ${config}`);
  }
  await rm(world.root, { recursive: true, force: true });
  world.root = '';
});
