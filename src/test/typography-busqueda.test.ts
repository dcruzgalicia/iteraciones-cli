import { describe, expect, test } from 'bun:test';
import {
  envuelveParrafoContenedor,
  esTituloDeSeccion,
  normalizaParaBusqueda,
  objetivosParaIncidencia,
  remplazaEspacioAnterior,
  remplazaEspacioPosterior,
  tienePalabraSuelta,
  yaAplicado,
} from '../cli/typography.ts';
import type { SingleWordLine, TypographyIncidence } from '../lib/pdf-typography.ts';

const incidencia = (text: string, extra: Partial<SingleWordLine> = {}): TypographyIncidence => ({
  type: 'single-word-line',
  page: 1,
  line: 1,
  text,
  ...extra,
});

const corrida = (text: string, type: 'repeated-last-letter' | 'repeated-first-letter' = 'repeated-last-letter'): TypographyIncidence => ({
  type,
  page: 1,
  line: 1,
  text,
  letter: 'a',
  lineas: [{ line: 1, text }],
  total: 1,
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

describe('tienePalabraSuelta', () => {
  test('reconoce encabezados como palabra suelta y no coincidencias dentro de prosa', () => {
    expect(tienePalabraSuelta('---\ntitle: Otra cosa\n---\n\n# Nota\n', 'nota')).toBe(true);
    expect(tienePalabraSuelta('---\ntitle: Otra cosa\n---\n\nuna nota final.\n', 'nota')).toBe(false);
  });
});

describe('esTituloDeSeccion', () => {
  test('detecta el encabezado que coincide con la incidencia', () => {
    expect(esTituloDeSeccion('---\ntitle: Otra cosa\n---\n\n# Nota\n', incidencia('Nota'))).toBe(true);
    expect(esTituloDeSeccion('---\ntitle: Otra cosa\n---\n\n# Nota\n', incidencia('nota.'))).toBe(false);
    expect(esTituloDeSeccion('---\ntitle: Otra cosa\n---\n\nuna nota final.\n', incidencia('nota'))).toBe(false);
  });
});

describe('espacios pegados con &nbsp;', () => {
  test('aplican dentro de un bloque runt', () => {
    const md = '::: {runt=2}\nse necesita; escritora desde niña\n:::\n';
    expect(remplazaEspacioPosterior(md, 'necesita; escritora')).toBe('::: {runt=2}\nse necesita; escritora&nbsp;desde niña\n:::\n');
    expect(remplazaEspacioAnterior('::: {runt=2}\nllega este;\n:::\n', 'este;')).toBe('::: {runt=2}\nllega&nbsp;este;\n:::\n');
  });

  test('igualan las comillas tipográficas del PDF con las rectas del markdown', () => {
    expect(remplazaEspacioPosterior('te dije "hola mundo" alto\n', '“hola mundo”')).toBe('te dije "hola mundo"&nbsp;alto\n');
  });

  test('aplican dentro de un escalar de bloque del frontmatter, no en el resto del YAML', () => {
    expect(remplazaEspacioPosterior('---\ncolophon: |\n  texto brindar un enlace\n---\n', 'texto brindar')).toBe(
      '---\ncolophon: |\n  texto brindar&nbsp;un enlace\n---\n',
    );
    expect(remplazaEspacioPosterior('---\ntitle: se necesita; escritora\n---\n', 'necesita; escritora')).toBeUndefined();
  });

  test('no tocan el contenido de un bloque qr', () => {
    expect(remplazaEspacioPosterior('::: {qr=15mm}\nhttps://x.com/a b\n:::\n', 'https://x.com/a')).toBeUndefined();
  });

  test('no cruzan un corte de párrafo ni se repiten en una segunda pasada', () => {
    expect(remplazaEspacioPosterior('fin de párrafo\n\nsiguiente párrafo\n', 'fin de párrafo')).toBeUndefined();
    const ya = '::: {runt=2}\nse necesita; escritora&nbsp;desde niña\n:::\n';
    expect(yaAplicado(ya, 'necesita; escritora', corrida('se necesita'))).toBe(true);
    expect(yaAplicado('::: {runt=2}\nse necesita; escritora desde niña\n:::\n', 'necesita; escritora', corrida('se necesita'))).toBe(false);
    expect(yaAplicado('::: {runt=2}\nllega&nbsp;este;\n:::\n', 'este;', corrida('este;', 'repeated-first-letter'))).toBe(true);
  });
});

describe('objetivosParaIncidencia', () => {
  test('el primer objetivo pega el &nbsp; en la unión de las líneas, no a media línea', () => {
    const inc: TypographyIncidence = {
      type: 'repeated-last-letter',
      page: 19,
      line: 14,
      text: 'Mi mamá no fue una mujer muy cariñosa, no se permitía',
      letter: 'a',
      lineas: [
        { line: 14, text: '  Mi mamá no fue una mujer muy cariñosa, no se permitía' },
        { line: 15, text: 'las caricias, las palabras tiernas o melosas. Al contrario, era' },
      ],
      total: 2,
    };
    const objetivos = objetivosParaIncidencia(inc);
    expect(objetivos[0]).toBe('no se permitía');
    expect(remplazaEspacioPosterior('cariñosa, no se permitía las caricias.\n', objetivos[0] as string)).toBe(
      'cariñosa, no se permitía&nbsp;las caricias.\n',
    );
  });

  test('alarga la aguja de la unión cuando la corta es ambigua', () => {
    const inc: TypographyIncidence = {
      type: 'repeated-last-letter',
      page: 41,
      line: 1,
      text: 'atenta, y fue muy reconfortante el acurrucamiento de los',
      letter: 's',
      lineas: [
        { line: 1, text: 'atenta, y fue muy reconfortante el acurrucamiento de los' },
        { line: 2, text: 'gatos y los perros. Ahora agradezco su compañía desde los' },
      ],
      total: 3,
    };
    const objetivos = objetivosParaIncidencia(inc);
    expect(objetivos.slice(0, 3)).toEqual(['acurrucamiento de los', 'de los', 'los']);
    const md = 'Hablo de los gatos, y fue muy reconfortante el acurrucamiento de los gatos y los perros.\n';
    expect(remplazaEspacioPosterior(md, 'de los')).toBeUndefined();
    expect(remplazaEspacioPosterior(md, objetivos[0] as string)).toBe(
      'Hablo de los gatos, y fue muy reconfortante el acurrucamiento de los&nbsp;gatos y los perros.\n',
    );
  });
});
