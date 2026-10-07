import { Given, Then, When } from '@cucumber/cucumber';
import { formatUserError, translateSystemError } from '../../lib/errors.js';
import { world } from './cli-world.steps.ts';

function errorConCodigo(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

Given('un error de la clase:', (bloque: string) => {
  const limpio = docstring(bloque);
  const [clase, ...resto] = limpio.split(';;');
  world.errClase = (clase ?? '').trim();
  world.errMensaje = resto.join(';;').trim();
});

Given('un error del sistema con el código:', (code: string) => {
  world.errCodigo = docstring(code);
});

Given('un valor que no es un error:', (valor: string) => {
  world.errValor = docstring(valor);
});

Given('la pista:', (hint: string) => {
  world.errHint = docstring(hint);
});

function docstring(bloque: string): string {
  return bloque
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

When('lo formateo para el autor', () => {
  world.errFormatado = formatUserError(construir());
});

When('traduzco el error del sistema', () => {
  world.errFormatado = translateSystemError(construir(), world.errHint as string | undefined);
});

function construir(): unknown {
  const valor = world.errValor as string | undefined;
  const codigo = world.errCodigo as string | undefined;
  if (valor !== undefined && valor !== '') {
    return Number.isNaN(Number(valor)) ? valor : Number(valor);
  }
  if (codigo !== undefined && codigo !== '') return errorConCodigo(codigo);
  const mensaje = world.errMensaje as string;
  switch (world.errClase) {
    case 'SyntaxError':
      return new SyntaxError(mensaje);
    case 'TypeError':
      return new TypeError(mensaje);
    default:
      return new Error(mensaje);
  }
}

Then('el autor lee:', (esperado: string) => {
  const leido = String(world.errFormatado);
  const querer = docstring(esperado);
  if (leido !== querer) {
    throw new Error(`el autor lee ${JSON.stringify(leido)} y debería leer ${JSON.stringify(querer)}`);
  }
});
