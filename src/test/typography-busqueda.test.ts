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
import { analyzeText } from '../lib/pdf-typography.ts';

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
    expect(yaAplicado(ya, 'necesita; escritora', true)).toBe(true);
    expect(yaAplicado('::: {runt=2}\nse necesita; escritora desde niña\n:::\n', 'necesita; escritora', true)).toBe(false);
    expect(yaAplicado('::: {runt=2}\nllega&nbsp;este;\n:::\n', 'este;', false)).toBe(true);
  });

  test('la aguja cruza un corte de línea del markdown, nunca una línea en blanco', () => {
    const md = 'a veces regreso a la compu. Como hoy, pues no he\nterminado el último capítulo de la tesis.\n';
    expect(remplazaEspacioPosterior(md, 'no he terminado el')).toBe(
      'a veces regreso a la compu. Como hoy, pues no he\nterminado el&nbsp;último capítulo de la tesis.\n',
    );
    expect(yaAplicado('pues no he\nterminado el&nbsp;último capítulo', 'no he terminado el', true)).toBe(true);
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
    expect(yaAplicado('pues no he terminado\u00a0el&nbsp;último capítulo', 'no he terminado el', true)).toBe(true);
  });

  test('no pega contra una línea que abre o cierra bloque', () => {
    const div = '::: {runt=2}\nMi trabajo parte de la observación de lo cotidiano.\n:::\n';
    expect(remplazaEspacioAnterior(div, 'Mi trabajo parte de la observación')).toBeUndefined();
    expect(remplazaEspacioAnterior('titleback: |\n  Texto de la contraportada que sigue.\n', 'Texto de la contraportada')).toBeUndefined();
    expect(remplazaEspacioAnterior('Antes venía esto.\n- Cuidarme como prioridad\n', 'Cuidarme como')).toBeUndefined();
    expect(remplazaEspacioPosterior('Termina el cuerpo.\n:::\n', 'Termina el cuerpo')).toBeUndefined();
    expect(remplazaEspacioPosterior('Fin del bloque\n---\n', 'Fin del bloque')).toBeUndefined();
    expect(remplazaEspacioPosterior('  Contraportada\nuppertitleback: |\n', 'Contraportada')).toBeUndefined();
    expect(remplazaEspacioAnterior('titleback: |\n  Línea uno\n  Línea dos\n', 'Línea dos')).toBe('titleback: |\n  Línea uno&nbsp;Línea dos\n');
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
    expect(objetivos[0]?.aguja).toBe('Mi mamá no fue una mujer muy cariñosa, no se permitía');
    const md = 'Mi mamá no fue una mujer muy cariñosa, no se permitía las caricias, las palabras tiernas o melosas.\n';
    expect(remplazaEspacioPosterior(md, objetivos[0]?.aguja as string)).toBe(
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
    expect(objetivos[0]?.aguja.endsWith('mal contada que ya no')).toBe(true);
    const md = 'Como una historia mal contada que ya no encajaba. Y otra que ya no sigue.\n';
    expect(remplazaEspacioPosterior(md, 'ya no')).toBeUndefined();
    expect(remplazaEspacioPosterior(md, 'mal contada que ya no')).toBe(
      'Como una historia mal contada que ya no&nbsp;encajaba. Y otra que ya no sigue.\n',
    );
  });

  test('repeated-first-letter pega antes de la primera palabra de la línea siguiente', () => {
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
    expect(objetivos[0]?.aguja).toBe('cada año, por no haberme terminado los tratamientos para');
    const md = 'por no haberme hecho chequeos médicos cada año, por no haberme terminado los tratamientos para la artritis.\n';
    expect(remplazaEspacioAnterior(md, objetivos[0]?.aguja as string)).toBe(
      'por no haberme hecho chequeos médicos&nbsp;cada año, por no haberme terminado los tratamientos para la artritis.\n',
    );
  });

  test('repeated-first-letter hace lo mismo que last-letter: pega al final de la primera línea', () => {
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
    expect(objetivos[0]?.aguja).toBe('salía tan natural como respirar. Descubrí que no, cuando a');
    const md =
      'di por sentado que eso hacían las madres, principalmente, y les salía tan natural como respirar. Descubrí que no, cuando a mi papá y a mí nos tocó cuidarnos entre nosotros.\n';
    expect(remplazaEspacioAnterior(md, objetivos[0]?.aguja as string)).toBe(
      'di por sentado que eso hacían las madres, principalmente, y les&nbsp;salía tan natural como respirar. Descubrí que no, cuando a mi papá y a mí nos tocó cuidarnos entre nosotros.\n',
    );
  });

  test('si la unión no se puede pegar, el &nbsp; va al final de la segunda línea', () => {
    const inc: TypographyIncidence = {
      type: 'repeated-first-letter',
      page: 40,
      line: 15,
      text: 'las noches en los primeros meses), mientras manejaba, so-',
      letter: 'l',
      lineas: [
        { line: 15, text: 'las noches en los primeros meses), mientras manejaba, so-' },
        { line: 16, text: 'la en mi casa, en la casa de mi pareja, con mi mamá; hasta' },
      ],
      total: 3,
    };
    const objetivos = objetivosParaIncidencia(inc);
    const md =
      'casi todas las noches en los primeros&nbsp;meses), mientras manejaba, sola&nbsp;en mi casa, en la casa de mi pareja, con mi mamá; hasta lloré&nbsp;con una consultante.\n';
    expect(remplazaEspacioAnterior(md, objetivos[0]?.aguja as string)).toBeUndefined();
    const cortada = objetivos.find((o) => o.aguja.endsWith('sola'));
    expect(cortada?.aguja).toBe('las noches en los primeros meses), mientras manejaba, sola');
    expect(cortada?.posterior).toBe(true);
    expect(yaAplicado(md, cortada?.aguja as string, true)).toBe(true);
    const cierre = objetivos.find((o) => o.posterior && o.aguja.endsWith('hasta'));
    expect(cierre?.aguja).toBe('la en mi casa, en la casa de mi pareja, con mi mamá; hasta');
    expect(remplazaEspacioPosterior(md, cierre?.aguja as string)).toBe(
      'casi todas las noches en los primeros&nbsp;meses), mientras manejaba, sola&nbsp;en mi casa, en la casa de mi pareja, con mi mamá; hasta&nbsp;lloré&nbsp;con una consultante.\n',
    );
  });

  test('con la palabra cortada aún sin nbsp, el &nbsp; va tras la palabra completa', () => {
    const inc: TypographyIncidence = {
      type: 'repeated-first-letter',
      page: 48,
      line: 10,
      text: 'Porque también se derrumbó mi otra casa, donde se su-',
      letter: 'p',
      lineas: [
        { line: 10, text: 'Porque también se derrumbó mi otra casa, donde se su-' },
        { line: 11, text: 'pone que iba a respirar. Y aunque llevaba mucho tiempo en' },
      ],
      total: 2,
    };
    const objetivos = objetivosParaIncidencia(inc);
    const cortada = objetivos.find((o) => o.aguja.endsWith('supone'));
    expect(cortada?.aguja).toBe('Porque también se derrumbó mi otra casa, donde se supone');
    expect(cortada?.posterior).toBe(true);
    const md = 'Porque también se derrumbó mi otra casa, donde se supone que iba a respirar. Y aunque llevaba mucho tiempo en él.\n';
    expect(yaAplicado(md, cortada?.aguja as string, true)).toBe(false);
    expect(remplazaEspacioPosterior(md, cortada?.aguja as string)).toBe(
      'Porque también se derrumbó mi otra casa, donde se supone&nbsp;que iba a respirar. Y aunque llevaba mucho tiempo en él.\n',
    );
  });

  test('consecutive-punctuation pone el &nbsp; donde last-letter: unión, palabra cortada y segunda línea', () => {
    const base = { page: 19, line: 13, text: 'convertí en una adulta y me hice cargo de mí misma.', total: 3 };
    const lineas = [
      { line: 13, text: base.text },
      { line: 14, text: '   Mi mamá no fue una mujer muy cariñosa, no se permi-' },
    ];
    const conPuntuacion: TypographyIncidence = { ...base, type: 'consecutive-punctuation', lineas };
    const conLetra: TypographyIncidence = { ...base, type: 'repeated-last-letter', letter: 'a', lineas };
    expect(objetivosParaIncidencia(conPuntuacion)).toEqual(objetivosParaIncidencia(conLetra));
    const objetivos = objetivosParaIncidencia(conPuntuacion);
    expect(objetivos[0]).toEqual({ aguja: 'convertí en una adulta y me hice cargo de mí misma.', posterior: true });
    const cierre = objetivos.findIndex((o) => o.aguja === 'Mi mamá no fue una mujer muy cariñosa, no se permi-');
    expect(cierre).toBeGreaterThan(0);
    expect(objetivos.map((o) => o.aguja)).not.toContain('cariñosa, no');
    expect(objetivos.map((o) => o.aguja)).not.toContain('misma. Mi');
    const conCorte: TypographyIncidence = { ...conPuntuacion, continuacion: 'tía las caricias, las palabras tiernas o melosas.' };
    const completada = objetivosParaIncidencia(conCorte).find((o) => o.aguja.endsWith('no se permitía'));
    expect(completada?.posterior).toBe(true);
  });
});

describe('analyzeText', () => {
  test('ordena el informe igual que las correcciones: last-letter, puntuación y first-letter', () => {
    const lineas = ['Ana teje bufandas', 'Beto come pan,', 'Beto corta cedros,', 'Carla canta coplas', 'Carlos corta cebras'];
    const tipos = analyzeText(lineas.join('\n'), { lineasMinimas: 2, letrasMinimas: 1, porcentajeCorta: 1 }).map((i) => i.type);
    expect(tipos).toEqual(['repeated-last-letter', 'consecutive-punctuation', 'repeated-first-letter', 'repeated-first-letter']);
  });
});
