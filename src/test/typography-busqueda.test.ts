import { describe, expect, test } from 'bun:test';
import { envuelveParrafoContenedor, normalizaParaBusqueda } from '../cli/typography.ts';
import type { SingleWordLine, TypographyIncidence } from '../lib/pdf-typography.ts';

const incidencia = (text: string, extra: Partial<SingleWordLine> = {}): TypographyIncidence => ({
  type: 'single-word-line',
  page: 1,
  line: 1,
  text,
  ...extra,
});

describe('normalizaParaBusqueda', () => {
  test('quita divs en línea conservando el texto visible', () => {
    expect(normalizaParaBusqueda('lo vivimos [en carne propia]{.no-mbox}.')).toBe('lo vivimos en carne propia.');
  });

  test('quita énfasis y enlaces conservando el texto', () => {
    expect(normalizaParaBusqueda('**negrita** *cursiva* `código` [texto](url)')).toBe('negrita cursiva código texto');
  });
});

describe('envuelveParrafoContenedor', () => {
  test('envuelve el párrafo dentro de un atributo de bloque del frontmatter', () => {
    const md = '---\ntitleback: |\n  *Antologadora*\n\n  otra línea\n---\ncuerpo\n';
    const nuevo = envuelveParrafoContenedor(md, incidencia('Antologadora'));
    expect(nuevo).toBe('---\ntitleback: |\n  ::: {runt=2}\n  *Antologadora*\n  :::\n\n  otra línea\n---\ncuerpo\n');
    expect(envuelveParrafoContenedor(nuevo as string, incidencia('Antologadora'))).toBeUndefined();
  });

  test('convierte el title escalar en bloque con runt', () => {
    const md = '---\ntitle: Promissus\n---\ncuerpo\n';
    const nuevo = envuelveParrafoContenedor(md, incidencia('PROMISSUS'));
    expect(nuevo).toBe('---\ntitle: |\n  ::: {runt=2}\n  Promissus\n  :::\n---\ncuerpo\n');
    expect(envuelveParrafoContenedor(nuevo as string, incidencia('PROMISSUS'))).toBeUndefined();
  });

  test('desambigua con la línea siguiente entre dos coincidencias', () => {
    const md = '---\ntitleback: |\n  *Antologadora*\n\n  otra cosa\n\n  *Antologadora*\n\n  [Ángeles Sanlopez]{.smallcaps}\n---\ncuerpo\n';
    const nuevo = envuelveParrafoContenedor(md, incidencia('Antologadora', { next: 'Ángeles Sanlopez' }));
    expect(nuevo).toBe(
      '---\ntitleback: |\n  *Antologadora*\n\n  otra cosa\n\n  ::: {runt=2}\n  *Antologadora*\n  :::\n\n  [Ángeles Sanlopez]{.smallcaps}\n---\ncuerpo\n',
    );
  });

  test('envuelve el párrafo del cuerpo y no el frontmatter', () => {
    const md = '---\ntitle: Otra cosa\n---\nUn párrafo que termina en\npalabra.\n';
    expect(envuelveParrafoContenedor(md, incidencia('palabra.'))).toBe(
      '---\ntitle: Otra cosa\n---\n::: {runt=2}\nUn párrafo que termina en\npalabra.\n:::',
    );
  });
});
