import { describe, expect, test } from 'bun:test';
import { filtraExcepciones, parseaExcepciones, type TypographyIncidence } from '../lib/pdf-typography.ts';

describe('excepciones tipográficas', () => {
  test('parsea bloques separados por archivo y línea en blanco', () => {
    const texto = `dist/files/a.pdf
  pág 2  líneas 4-6  consecutive-punctuation
         4  una
         5  dos
         6  tres

dist/files/b.pdf
  pág 7  línea 1  single-word-line  Hola
`;
    const excepciones = parseaExcepciones(texto);
    expect(excepciones).toHaveLength(2);
    expect(excepciones[0]?.file).toBe('dist/files/a.pdf');
    expect(excepciones[0]?.total).toBe(3);
    expect(excepciones[1]?.type).toBe('single-word-line');
  });

  test('filtra sólo coincidencia exacta de archivo y contenido', () => {
    const texto = `dist/files/a.pdf
  pág 2  líneas 4-6  consecutive-punctuation
         4  una
         5  dos
         6  tres
`;
    const excepciones = parseaExcepciones(texto);
    const incidencias = [
      {
        type: 'consecutive-punctuation',
        page: 2,
        line: 4,
        text: 'x',
        lineas: [
          { line: 4, text: 'una' },
          { line: 5, text: 'dos' },
          { line: 6, text: 'tres' },
        ],
        total: 3,
      },
      {
        type: 'consecutive-punctuation',
        page: 2,
        line: 4,
        text: 'x',
        lineas: [
          { line: 4, text: 'cambiada' },
          { line: 5, text: 'dos' },
          { line: 6, text: 'tres' },
        ],
        total: 3,
      },
    ] as TypographyIncidence[];
    const filtradas = filtraExcepciones(incidencias, 'dist/files/a.pdf', excepciones);
    expect(filtradas).toHaveLength(1);
  });
});
