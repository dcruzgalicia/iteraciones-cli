import { describe, expect, test } from 'bun:test';
import { normalizaParaBusqueda } from '../cli/typography.ts';

describe('normalizaParaBusqueda', () => {
  test('quita divs en línea conservando el texto visible', () => {
    expect(normalizaParaBusqueda('lo vivimos [en carne propia]{.no-mbox}.')).toBe('lo vivimos en carne propia.');
  });

  test('quita énfasis y enlaces conservando el texto', () => {
    expect(normalizaParaBusqueda('**negrita** *cursiva* `código` [texto](url)')).toBe('negrita cursiva código texto');
  });
});
