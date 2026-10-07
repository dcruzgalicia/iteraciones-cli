import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { CommanderError } from 'commander';
import { runBuild, runClean, runDoctor, runFilters, runInit, runNew, runValidate } from '../../cli/dispatcher.js';
import { checkReadPermissions, checkWritePermissions } from '../../cli/doctor/system-checks.js';
import { buildProgram } from '../../cli/parser.js';
import { capture, world } from './cli-world.steps.js';

interface Check {
  ok: boolean;

  detail?: string;
}

const checks = {
  read: { ok: true, detail: '' } as Check,
  write: { ok: true, detail: '' } as Check,
};

const COMMANDS: Record<string, (root: string) => Promise<unknown>> = {
  build: runBuild,
  validate: runValidate,
  doctor: runDoctor,
  new: (root) => runNew(root, 'doc.md'),
  clean: runClean,
  'list-filters': runFilters,
  init: runInit,
};

Given('que la raíz del proyecto no existe', () => {
  world.root = join(tmpdir(), `no-existe-${process.pid}-${Date.now()}`);
});

When('parseo el argv {string}', async (argv: string) => {
  await capture(async () => {
    try {
      await buildProgram().parseAsync(['bun', 'bin.ts', ...argv.split(' ').filter(Boolean)]);
    } catch (err) {
      process.exitCode = err instanceof CommanderError ? err.exitCode : 1;
    }
  });
});

When('corro {string}', async (comando: string) => {
  await capture(async () => {
    const run = COMMANDS[comando];
    if (!run) throw new Error(`el escenario pide un comando que el dispatcher no tiene: ${comando}`);
    await run(world.root);
  });
});

When('reviso los permisos de lectura y escritura', async () => {
  checks.read = await checkReadPermissions(world.root);
  checks.write = await checkWritePermissions(world.root);
});

Then('el error sugiere el comando {string}', (sugerido: string) => {
  const esperado = `(¿Quisiste decir ${sugerido}?)`;
  if (!world.stderr.includes(esperado)) {
    throw new Error(`el error no sugiere ${JSON.stringify(esperado)}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

Then('el error no muestra un stack trace', () => {
  if (world.stderr.includes('at <anonymous>')) {
    throw new Error(`el error sí trae un stack trace: ${JSON.stringify(world.stderr)}`);
  }
});

Then('el error dice que la ruta no existe', () => {
  if (!world.stderr.includes('no existe')) {
    throw new Error(`el error no dice que la ruta no existe: ${JSON.stringify(world.stderr)}`);
  }
});

Then('la ayuda contiene {string}', (esperado: string) => {
  if (!world.stdout.includes(esperado)) {
    throw new Error(`la ayuda no contiene ${JSON.stringify(esperado)}. stdout: ${JSON.stringify(world.stdout)}`);
  }
});

Then('la ayuda no muestra {string}', (ingles: string) => {
  if (world.stdout.includes(ingles)) {
    throw new Error(`la ayuda sí muestra el inglés ${JSON.stringify(ingles)}`);
  }
});

Then('la ayuda repite {string} una sola vez', (texto: string) => {
  const veces = world.stdout.split(texto).length - 1;
  if (veces !== 1) {
    throw new Error(`esperaba ${JSON.stringify(texto)} una vez y apareció ${veces} veces`);
  }
});

Then('la ayuda empieza con el slogan', () => {
  if (!world.stdout.startsWith('escribir, compartir, re-existir')) {
    throw new Error(`la ayuda no empieza con el slogan: ${JSON.stringify(world.stdout.slice(0, 80))}`);
  }
});

Then('ambos checks fallan', () => {
  if (checks.read.ok || checks.write.ok) {
    throw new Error('los checks de permisos deberían fallar sobre una raíz inexistente');
  }
});

Then('ambos detalles dicen que la ruta no existe', () => {
  for (const [nombre, check] of [
    ['lectura', checks.read],
    ['escritura', checks.write],
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
});
