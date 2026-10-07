import { Given, Then, When } from '@cucumber/cucumber';
import { formatUserError, translateSystemError } from '../../lib/errors.js';
import { world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — cómo se le enseña un error al autor.
 *
 * ## Se quita el prefijo de la clase, no la palabra
 *
 * `BuildError: build falló` se muestra como `build falló`: el autor ya sabe que
 * es un error, repetirlo le quita espacio para lo que importa. Pero `Error` EN
 * MEDIO del mensaje se conserva: `Error en línea 5: token inesperado` habla del
 * YAML que se está parseando, y quitar ahí la palabra rompería la frase.
 *
 * ## Los códigos del sistema se traducen; los desconocidos no
 *
 * `EACCES` no le dice nada a nadie. `sin permisos de lectura` sí. Un código que
 * no está en la tabla se devuelve tal cual: inventar una traducción para algo que
 * no se conoce sería mentir sobre la causa.
 *
 * ## El `hint` distingue los dos ENOENT
 *
 * Un documento que falta es casi siempre un nombre mal escrito, así que el
 * mensaje pide verificarlo. Un recurso interno que falta no: el texto de sistema
 * se queda como estaba, porque ahí la causa no es el nombre.
 */

/** Un error de sistema con su código, como los que lanza `node:fs`. */
function errorConCodigo(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

Given('un error de la clase:', (bloque: string) => {
  // `clase ;; mensaje`: los mensajes llevan `:` y espacios con una frecuencia
  // que no compensa pelearse con el escapado de un `{string}`.
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

/** Un docstring llega con su indentación; el valor es el texto sin bordes. */
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

/** El error que el escenario declaró, con la forma que toca. */
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
