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

  test('la aguja cruza un corte de línea del markdown, nunca una línea en blanco', () => {
    const md = 'a veces regreso a la compu. Como hoy, pues no he\nterminado el último capítulo de la tesis.\n';
    expect(remplazaEspacioPosterior(md, 'no he terminado el')).toBe(
      'a veces regreso a la compu. Como hoy, pues no he\nterminado el&nbsp;último capítulo de la tesis.\n',
    );
    expect(yaAplicado('pues no he\nterminado el&nbsp;último capítulo', 'no he terminado el', corrida('no he terminado el'))).toBe(true);
    expect(remplazaEspacioPosterior('fin\n\nel resto\n', 'fin el')).toBeUndefined();
    expect(remplazaEspacioAnterior('fin\n\nel resto\n', 'el resto')).toBeUndefined();
  });

  test('la aguja también cruza un espacio ya pegado en la fuente', () => {
    expect(remplazaEspacioPosterior('pues no he terminado\u00a0el último capítulo\n', 'no he terminado el')).toBe(
      'pues no he terminado\u00a0el&nbsp;último capítulo\n',
    );
    expect(remplazaEspacioPosterior('pues no he terminado&nbsp;el último capítulo\n', 'no he terminado el')).toBe(
      'pues no he terminado&nbsp;el&nbsp;último capítulo\n',
    );
    expect(yaAplicado('pues no he terminado\u00a0el&nbsp;último capítulo', 'no he terminado el', corrida('no he terminado el'))).toBe(true);
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
    expect(objetivos[0]).toBe('Mi mamá no fue una mujer muy cariñosa, no se permitía');
    const md = 'Mi mamá no fue una mujer muy cariñosa, no se permitía las caricias, las palabras tiernas o melosas.\n';
    expect(remplazaEspacioPosterior(md, objetivos[0] as string)).toBe(
      'Mi mamá no fue una mujer muy cariñosa, no se permitía&nbsp;las caricias, las palabras tiernas o melosas.\n',
    );
  });

  test('alarga la aguja de la unión cuando las cortas son ambiguas', () => {
    const inc: TypographyIncidence = {
      type: 'repeated-last-letter',
      page: 44,
      line: 2,
      text: 'en el cuerpo. Como una historia mal contada que ya no',
      letter: 'o',
      lineas: [
        { line: 2, text: 'en el cuerpo. Como una historia mal contada que ya no' },
        { line: 3, text: 'encajaba. Como una sensación persistente de que algo no' },
      ],
      total: 3,
    };
    const objetivos = objetivosParaIncidencia(inc);
    expect(objetivos[0]?.endsWith('mal contada que ya no')).toBe(true);
    const md = 'Como una historia mal contada que ya no encajaba. Y otra que ya no sigue.\n';
    expect(remplazaEspacioPosterior(md, 'ya no')).toBeUndefined();
    expect(remplazaEspacioPosterior(md, 'mal contada que ya no')).toBe(
      'Como una historia mal contada que ya no&nbsp;encajaba. Y otra que ya no sigue.\n',
    );
  });

  test('repeated-first-letter pega antes de la primera palabra de la primera línea', () => {
    const inc: TypographyIncidence = {
      type: 'repeated-first-letter',
      page: 20,
      line: 7,
      text: 'sentado que eso hacían las madres, principalmente, y les',
      letter: 's',
      lineas: [
        { line: 7, text: 'sentado que eso hacían las madres, principalmente, y les' },
        { line: 8, text: 'salía tan natural como respirar. Descubrí que no, cuando a' },
      ],
      total: 2,
    };
    const objetivos = objetivosParaIncidencia(inc);
    expect(objetivos[0]).toBe('sentado que eso hacían las madres, principalmente, y les');
    const md = 'di por sentado que eso hacían las madres, principalmente, y les salía tan natural como respirar.\n';
    expect(remplazaEspacioAnterior(md, objetivos[0] as string)).toBe(
      'di por&nbsp;sentado que eso hacían las madres, principalmente, y les salía tan natural como respirar.\n',
    );
  });

  test('repeated-first-letter recurre a la línea siguiente si la primera no es pegable', () => {
    // la línea inicial arranca con el fragmento «cicio» de «ejercicio»: no hay espacio antes
    const inc: TypographyIncidence = {
      type: 'repeated-first-letter',
      page: 22,
      line: 27,
      text: 'cicio más joven, por no haberme hecho chequeos médicos',
      letter: 'c',
      lineas: [
        { line: 27, text: 'cicio más joven, por no haberme hecho chequeos médicos' },
        { line: 28, text: 'cada año, por no haberme terminado los tratamientos para' },
      ],
      total: 2,
    };
    const objetivos = objetivosParaIncidencia(inc);
    expect(objetivos[0]).toBe('cicio más joven, por no haberme hecho chequeos médicos');
    const md = 'por no haberme hecho chequeos médicos cada año, por no haberme terminado los tratamientos para la artritis.\n';
    expect(remplazaEspacioAnterior(md, objetivos[0] as string)).toBeUndefined();
    const cabezaSiguiente = 'cada año, por no haberme terminado los tratamientos para';
    expect(objetivos.includes(cabezaSiguiente)).toBe(true);
    expect(remplazaEspacioAnterior(md, cabezaSiguiente)).toBe(
      'por no haberme hecho chequeos médicos&nbsp;cada año, por no haberme terminado los tratamientos para la artritis.\n',
    );
  });
});
