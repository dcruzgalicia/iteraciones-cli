import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { runBuild, runClean, runValidate } from '../../cli/dispatcher.js';
import { buildProgram } from '../../cli/parser.js';
import { capture, jsonSalida, tempRoot, world } from './cli-world.steps.js';

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

  await Bun.$`chmod 000 ${ruta(relativa)}`.quiet();
});

Given('que el estado del build declara la salida {string}', (salida: string) => {
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

Then('el archivo {string} quedó con este contenido', (relativa: string, contenido: string) => {
  const actual = readFileSync(ruta(relativa), 'utf8');
  if (actual !== contenido) {
    throw new Error(`${relativa} debería quedar intacto. Va:\n${JSON.stringify(actual)} y esperaba ${JSON.stringify(contenido)}`);
  }
});

Then('el directorio {string} existe', (relativa: string) => {
  if (!existsSync(ruta(relativa))) {
    throw new Error(`${relativa} no existe en ${world.root}`);
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
