import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { buildProgram } from '../../cli/parser.js';
import { capture, world } from './cli-world.steps.js';

/**
 * #2546 (onda 2) — tranche 4 de `cli-layer`: `validate` y `validate --json`.
 *
 * ## Los pasos de contenido de archivo son SÍNCRONOS a propósito
 *
 * Un step con docstring y función `async` no anda en cucumber-js 13:
 * `user_code_runner.js:31` decide `callbackInterface = fn.length ===
 * argsArray.length`, y con `{string}` + docstring los dos dan 2. Cree que el
 * docstring es el callback `done`, y con un `async` encima tira "function uses
 * multiple asynchronous interfaces".
 *
 * Por eso los `Given` que escriben archivos usan `writeFileSync`. El world
 * compartido vive en `cli-world.steps.ts`; `corro {string}` y los `Then` de
 * salida también.
 *
 * ## `validate` tiene dos salidas y no siempre por el mismo canal
 *
 * Los errores van por stderr. El resumen y la lista de los documentos que
 * "están bien" van por stdout. Los pasos de este archivo por eso miran los dos:
 * `la salida dice` para el resumen y `el error dice` para los problemas.
 */

interface Json {
  [clave: string]: unknown;
}

/** El `JSON.parse` de `stdout`, con el error apuntando al texto que falló. */
function jsonSalida(): Json {
  const crudo = world.stdout.trim();
  try {
    return JSON.parse(crudo) as Json;
  } catch (err) {
    throw new Error(`stdout no es JSON válido: ${(err as Error).message}\nva:\n${crudo}`);
  }
}

/** Los elementos de una clave del JSON, como lista de objetos. */
function lista(clave: string): Record<string, unknown>[] {
  const valor = jsonSalida()[clave];
  if (!Array.isArray(valor)) {
    throw new Error(`la clave ${JSON.stringify(clave)} del JSON no es una lista: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>[];
}

function escribir(ruta: string, contenido: string): void {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido, 'utf8');
}

Given('que la raíz del proyecto tiene un documento pero no la configuración', async () => {
  world.root = await mkdtemp(join(tmpdir(), 'iteraciones-cli-validate-'));
  escribir(join(world.root, 'doc.md'), '---\ntitle: Doc\ndate: 2026-01-01\n---\n\nTexto.\n');
});

Given('que el archivo {string} tiene este contenido', (ruta: string, contenido: string) => {
  escribir(join(world.root, ruta), contenido);
});

Given('que el archivo {string} tiene el contenido {string}', (ruta: string, contenido: string) => {
  escribir(join(world.root, ruta), contenido);
});

Given('que el archivo {string} está vacío', (ruta: string) => {
  escribir(join(world.root, ruta), '');
});

Given('que el documento {string} tiene el frontmatter {string}', (ruta: string, frontmatter: string) => {
  // El frontmatter entero, no una clave suelta: agregar `title: "Ok"` arriba
  // duplicaba la clave cuando el caso probaba justamente `title`.
  escribir(join(world.root, ruta), `---\n${frontmatter}\n---\n\n# Hola\n`);
});

Given('que el documento {string} tiene el frontmatter sin cerrar', (ruta: string) => {
  escribir(join(world.root, ruta), '---\ntitle: "sin cerrar\n---\n\nContenido.\n');
});

Given('que el documento {string} declara varios campos efectivos', (ruta: string) => {
  // Los ocho que llegan a pandoc o a la plantilla. Si alguno dejara de llegar,
  // `validate` empezaría a avisar "campo ignorado" sobre algo que sí se usa, y
  // ese aviso sería ruido.
  escribir(
    join(world.root, ruta),
    [
      '---',
      'title: Efectivos',
      'language: en',
      'toc: true',
      'description: Resumen',
      'site-title: Mi sitio',
      'theme: light',
      'accent: rose',
      '---',
      '',
      'Contenido.',
      '',
    ].join('\n'),
  );
});

Given('que la configuración declara la clave {string} con el valor {string}', (clave: string, valor: string) => {
  escribir(join(world.root, 'iteraciones.config.yaml'), `language: es-MX\n${clave}: ${valor}\n`);
});

// `disabledFilters` (global) y `disabledPreambleFilters` (dentro de
// `format.pdf`) son claves distintas con mensajes distintos: el primero avisa
// "no coincide con ningún filter", el segundo dispara el error de dependencia con
// 16-toc-styling. Un solo paso armaba la clave equivocada según el escenario.
Given('que la configuración desactiva un filtro global {string}', (filtro: string) => {
  escribir(join(world.root, 'iteraciones.config.yaml'), `language: es-MX\nformat:\n  html:\n    generate: true\ndisabledFilters:\n  - ${filtro}\n`);
});

Given('que la configuración desactiva un filtro del preámbulo {string}', (filtro: string) => {
  escribir(join(world.root, 'iteraciones.config.yaml'), `language: es-MX\nformat:\n  pdf:\n    disabledPreambleFilters:\n      - ${filtro}\n`);
});

When('valido el proyecto pidiendo JSON', async () => {
  await capture(async () => {
    try {
      await buildProgram().parseAsync(['bun', 'bin.ts', 'validate', '--json', '--project-root', world.root]);
    } catch (err) {
      // El JSON de validate siempre sale con 0 o 1 según el contenido, no según
      // una excepción: `exitOverride` no debería dispararse acá, pero si se
      // disparara el código de salida tiene que quedar en 1 y no en 0.
      process.exitCode = 1;
      throw err;
    }
  });
});

Then('el JSON declara la clave {string} con el valor verdadero', (clave: string) => {
  if (jsonSalida()[clave] !== true) {
    throw new Error(`${JSON.stringify(clave)} no es true en el JSON: ${world.stdout}`);
  }
});

Then('el JSON declara la clave {string} con el valor falso', (clave: string) => {
  if (jsonSalida()[clave] !== false) {
    throw new Error(`${JSON.stringify(clave)} no es false en el JSON: ${world.stdout}`);
  }
});

Then('el JSON declara la clave {string} con el número {int}', (clave: string, numero: number) => {
  if (jsonSalida()[clave] !== numero) {
    throw new Error(`${JSON.stringify(clave)} no es ${numero} en el JSON: ${world.stdout}`);
  }
});

Then('el JSON no declara errores', () => {
  const errores = lista('errors');
  if (errores.length > 0) {
    throw new Error(`el JSON declara ${errores.length} errores y no debería: ${world.stdout}`);
  }
});

Then('el JSON declara al menos {int} error', (minimo: number) => {
  const errores = lista('errors');
  if (errores.length < minimo) {
    throw new Error(`el JSON declara ${errores.length} errores y esperaba al menos ${minimo}: ${world.stdout}`);
  }
});

Then('el primer error es del archivo {string}', (archivo: string) => {
  const primero = lista('errors')[0];
  if (primero?.file !== archivo) {
    throw new Error(`el primer error viene de ${JSON.stringify(primero?.file)} y esperaba ${JSON.stringify(archivo)}`);
  }
});

Then('el primer error dice {string}', (texto: string) => {
  const primero = lista('errors')[0];
  const mensaje = String(primero?.message ?? '');
  if (!mensaje.includes(texto)) {
    throw new Error(`el primer error no dice ${JSON.stringify(texto)}. Dice: ${JSON.stringify(mensaje)}`);
  }
});

Then('el JSON declara exactamente {int} aviso que menciona {string}', (cuantos: number, texto: string) => {
  const avisos = lista('warnings').filter((a) => String(a.message ?? '').includes(texto));
  // El caso que importa es #2234: el aviso salía una vez por el texto y otra por
  // el JSON, y el consumidor lo contaba dos. Exactamente `cuantos`.
  if (avisos.length !== cuantos) {
    throw new Error(`el JSON declara ${avisos.length} avisos que mencionan ${JSON.stringify(texto)} y esperaba ${cuantos}: ${world.stdout}`);
  }
  world.ultimoAviso = avisos[0] ?? {};
});

Then('ese aviso viene del archivo {string}', (archivo: string) => {
  if (world.ultimoAviso?.file !== archivo) {
    throw new Error(`el aviso viene de ${JSON.stringify(world.ultimoAviso?.file)} y esperaba ${JSON.stringify(archivo)}`);
  }
});
