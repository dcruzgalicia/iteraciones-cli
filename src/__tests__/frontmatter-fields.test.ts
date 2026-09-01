import { describe, expect, it } from 'bun:test';
import { fmBool, fmString, fmStringList, fmTrimmedString, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';

describe('fmString', () => {
  it('acepta strings no vacíos sin recortar', () => {
    expect(fmString(' hola ', 'x')).toBe(' hola ');
  });
  it('cae al fallback con vacío, no-string o ausente', () => {
    expect(fmString('', 'x')).toBe('x');
    expect(fmString(3, 'x')).toBe('x');
    expect(fmString(undefined, 'x')).toBe('x');
  });
});

describe('fmBool', () => {
  it('acepta booleanos y cae al fallback en otro caso', () => {
    expect(fmBool(false, true)).toBe(false);
    expect(fmBool('false', true)).toBe(true);
    expect(fmBool(undefined, false)).toBe(false);
  });
});

describe('fmTrimmedString', () => {
  it('recorta y descarta vacíos', () => {
    expect(fmTrimmedString('  hola ')).toBe('hola');
    expect(fmTrimmedString('   ')).toBeUndefined();
    expect(fmTrimmedString(5)).toBeUndefined();
  });
});

describe('fmStringList', () => {
  it('string único → lista de uno; lista homogénea recortada sin huecos', () => {
    expect(fmStringList('Uno')).toEqual(['Uno']);
    expect(fmStringList([' A ', '', 'B'])).toEqual(['A', 'B']);
  });
  it('undefined si no hay valores útiles', () => {
    expect(fmStringList('')).toBeUndefined();
    expect(fmStringList([])).toBeUndefined();
    expect(fmStringList([1, 'a', 2])).toEqual(['a']);
    expect(fmStringList(null)).toBeUndefined();
  });
});

const fm = { title: 'Del fm', creator: ['Autor FM'], date: '2026-01-01' };
const fmt = { title: 'Del formato', creator: 'Autor formato' };
const root = { title: 'De la raíz', creator: ['Autor raíz'], date: '1999-12-31' };

describe('jerarquía frontmatter > format > raíz', () => {
  it('el frontmatter manda', () => {
    expect(resolveStringField(fm, fmt, root, 'title')).toBe('Del fm');
  });
  it('sin frontmatter, gana el formato; sin formato, la raíz', () => {
    expect(resolveStringField({}, fmt, root, 'title')).toBe('Del formato');
    expect(resolveStringField({}, undefined, root, 'date')).toBe('1999-12-31');
  });
  it('descarga tipos que no corresponden a la variante', () => {
    expect(resolveStringField({}, {}, root, 'creator')).toBeUndefined();
  });
  it('resolveMetadataField devuelve el valor crudo del primer nivel que lo tenga', () => {
    expect(resolveMetadataField(fm, fmt, root, 'creator')).toEqual(['Autor FM']);
    expect(resolveMetadataField({}, fmt, root, 'subject')).toBeUndefined();
  });
});
