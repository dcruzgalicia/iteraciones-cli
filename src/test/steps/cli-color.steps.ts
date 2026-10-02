import { spyOn } from 'bun:test';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { logWarning } from '../../lib/logger.js';

/**
 * #2546 (onda 2) — el logger y el color. Primer bloque de `cli-layer`.
 *
 * ## Este bloque va primero en `cli-layer`, por orden del issue
 *
 * Es el que el issue marca como el más sensible al world object compartido, y
 * tiene razón por un motivo concreto: **toca `process.stderr.isTTY` y
 * `process.env.NO_COLOR`**, que son estado global del proceso, y espía
 * `process.stderr.write`. Si el `After` de aislamiento no restaura las tres
 * cosas, los 172 escenarios siguientes heredan un stderr modificado.
 *
 * ## La precondición que el original escondía
 *
 * `cli-layer.test.ts` ponía `process.env.NO_COLOR = '1'` a NIVEL DE MÓDULO. El
 * bloque "color hermético en tests" pasaba por eso, no por `isTTY`: replicado
 * tal cual fuera de ese archivo, el logger **sí** emite ANSI.
 *
 * Aquí la precondición es explícita y se restaura. Un test que depende del
 * efecto lateral de otro archivo es un test que se rompe cuando ese archivo se
 * borra — que es exactamente lo que pasó al empezar esta migración.
 *
 * ## Por qué dos escenarios y no uno
 *
 * El primero demuestra que `NO_COLOR` gana sobre `isTTY`. El segundo que sin
 * él sí hay color. Sin el segundo, el primero pasaría igual si el logger no
 * coloreara nunca, y no comprobaría nada.
 */

interface ColorWorld {
  originalIsTTY: PropertyDescriptor | undefined;
  originalNoColor: string | undefined;
  chunks: unknown[];
  output: string;
}

const world: ColorWorld = { originalIsTTY: undefined, originalNoColor: undefined, chunks: [], output: '' };

Before(() => {
  world.originalIsTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  world.originalNoColor = process.env.NO_COLOR;
});

After(() => {
  // El espío de `write` lo restaura el `After` global con `mock.restore()`.
  // `isTTY` y `NO_COLOR` son suyos, y son estado GLOBAL del proceso: si se
  // filtran, todos los escenarios siguientes heredan un logger distinto.
  const stderr = process.stderr as { isTTY?: boolean };
  if (world.originalIsTTY) Object.defineProperty(process.stderr, 'isTTY', world.originalIsTTY);
  else delete stderr.isTTY;
  if (world.originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = world.originalNoColor;
});

Given('que stderr se presenta como una terminal', () => {
  Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  world.chunks = [];
  spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    world.chunks.push(chunk);
    return true;
  });
});

Given('el entorno pide no usar color', () => {
  process.env.NO_COLOR = '1';
});

Given('el entorno no pide color', () => {
  delete process.env.NO_COLOR;
});

When('el logger escribe una advertencia', () => {
  logWarning('mensaje de prueba', 'test');
  world.output = world.chunks.map((c) => String(c ?? '')).join('');
});

Then('la salida lleva el mensaje con su prefijo', () => {
  if (!world.output.includes('⚠') || !world.output.includes('[test]') || !world.output.includes('mensaje de prueba')) {
    throw new Error(`la salida no trae el mensaje con su prefijo. Escribió: ${JSON.stringify(world.output)}`);
  }
});

Then('la salida no lleva ningún código de control ANSI', () => {
  // `\x1b` abre una secuencia ANSI. Si aparece, el logger colorea y el output
  // deja de ser comparable byte a byte entre máquinas.
  if (world.output.includes('\x1b')) {
    throw new Error(`la salida lleva códigos ANSI: ${JSON.stringify(world.output)}`);
  }
});

Then('la salida lleva códigos de control ANSI', () => {
  // El contrario del otro escenario: sin `NO_COLOR` y con `isTTY`, el logger
  // tiene que colorear. Si esto falla, el logger dejó de colorear nunca y el
  // otro escenario no comprobaría nada.
  if (!world.output.includes('\x1b')) {
    throw new Error(`esperaba códigos ANSI en la salida y no hay: ${JSON.stringify(world.output)}`);
  }
});
