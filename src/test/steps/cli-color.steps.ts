import { spyOn } from 'bun:test';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { logWarning } from '../../lib/logger.js';

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
  if (world.output.includes('\x1b')) {
    throw new Error(`la salida lleva códigos ANSI: ${JSON.stringify(world.output)}`);
  }
});

Then('la salida lleva códigos de control ANSI', () => {
  if (!world.output.includes('\x1b')) {
    throw new Error(`esperaba códigos ANSI en la salida y no hay: ${JSON.stringify(world.output)}`);
  }
});
