import { describe, expect, test } from 'bun:test';
import { coerceToString, isTruthy, resolveValue } from '../render/context.js';

describe('resolveValue', () => {
  test('clave simple existente', () => {
    expect(resolveValue({ title: 'Hola' }, 'title')).toBe('Hola');
  });

  test('clave inexistente devuelve undefined', () => {
    expect(resolveValue({}, 'missing')).toBeUndefined();
  });

  test('ruta dotted de dos niveles', () => {
    expect(resolveValue({ author: { name: 'Ana' } }, 'author.name')).toBe('Ana');
  });

  test('ruta dotted de tres niveles', () => {
    expect(resolveValue({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  test('primer segmento inexistente en ruta dotted', () => {
    expect(resolveValue({}, 'a.b')).toBeUndefined();
  });

  test('segmento intermedio inexistente en ruta dotted', () => {
    expect(resolveValue({ a: {} }, 'a.b.c')).toBeUndefined();
  });

  test('clave vacía devuelve undefined', () => {
    expect(resolveValue({ x: 1 }, '')).toBeUndefined();
  });

  test('segmentos con espacios se recortan', () => {
    expect(resolveValue({ x: 99 }, ' x ')).toBe(99);
  });
});

describe('coerceToString', () => {
  test('string pasa tal cual', () => {
    expect(coerceToString('hola')).toBe('hola');
  });

  test('undefined → ""', () => {
    expect(coerceToString(undefined)).toBe('');
  });

  test('null → ""', () => {
    expect(coerceToString(null)).toBe('');
  });

  test('true → "true"', () => {
    expect(coerceToString(true)).toBe('true');
  });

  test('false → ""', () => {
    expect(coerceToString(false)).toBe('');
  });

  test('número → string', () => {
    expect(coerceToString(42)).toBe('42');
  });

  test('array de strings → join sin separador', () => {
    expect(coerceToString(['a', 'b', 'c'])).toBe('abc');
  });

  test('array vacío → ""', () => {
    expect(coerceToString([])).toBe('');
  });

  test('objeto plano → "true"', () => {
    expect(coerceToString({ x: 1 })).toBe('true');
  });
});

describe('isTruthy', () => {
  test('string no vacío → true', () => {
    expect(isTruthy('hola')).toBe(true);
  });

  test('string vacío → false', () => {
    expect(isTruthy('')).toBe(false);
  });

  test('array con elementos → true', () => {
    expect(isTruthy([1, 2])).toBe(true);
  });

  test('array vacío → false', () => {
    expect(isTruthy([])).toBe(false);
  });

  test('boolean true → true', () => {
    expect(isTruthy(true)).toBe(true);
  });

  test('boolean false → false', () => {
    expect(isTruthy(false)).toBe(false);
  });

  test('número positivo → true', () => {
    expect(isTruthy(1)).toBe(true);
  });

  test('cero → false', () => {
    expect(isTruthy(0)).toBe(false);
  });

  test('NaN → false', () => {
    expect(isTruthy(Number.NaN)).toBe(false);
  });

  test('Infinity → false (no finito)', () => {
    expect(isTruthy(Number.POSITIVE_INFINITY)).toBe(false);
  });

  test('objeto → true', () => {
    expect(isTruthy({ x: 1 })).toBe(true);
  });

  test('undefined → false', () => {
    expect(isTruthy(undefined)).toBe(false);
  });

  test('null → false', () => {
    expect(isTruthy(null)).toBe(false);
  });
});
