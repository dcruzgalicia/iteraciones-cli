import { describe, expect, it } from 'bun:test';
import { looseColonLines, looseColonsMessage } from '../builder/project-validator.js';

describe('looseColonLines (vocabulario semántico del cuerpo)', () => {
  it('detecta ":" suelta en su propia línea', () => {
    expect(looseColonLines('texto\n\n:\n\ntexto')).toEqual([3]);
  });

  it('detecta uno o varios ":" sueltos (:", ":::", "::::")', () => {
    expect(looseColonLines(':\n\ntexto\n\n:::\n\n::::\n')).toEqual([1, 5, 7]);
  });

  it('no marca "::" espaciador ni ":;" sin indentación', () => {
    const body = 'texto\n\n::\n\ntexto\n\n:;\n\ntexto';
    expect(looseColonLines(body)).toEqual([]);
  });

  it('no marca ":" con espacio final cuando es el espaciador (pandoc normaliza)', () => {
    expect(looseColonLines('texto\n\n:: \n\ntexto')).toEqual([]);
    expect(looseColonLines('texto\n\n:; \n\ntexto')).toEqual([]);
  });

  it('sí marca ":" con espacio final (sola, el espacio es ignorable)', () => {
    expect(looseColonLines('texto\n\n: \n\ntexto')).toEqual([3]);
  });

  it('no marca líneas con texto: horas, URLs, emojis ni ":" con contenido', () => {
    const body = 'Reunión a las 12:30\n\nhttps://ejemplo.com/nota\n\n:smile:\n\n:: con texto\n\n:; y texto\n\n`código: inline`';
    expect(looseColonLines(body)).toEqual([]);
  });

  it('no marca el cierre de un fenced div abierto con atributos', () => {
    const body = '::: {.dictum}\nCita de prueba\n:::\n';
    expect(looseColonLines(body)).toEqual([]);
  });

  it('marca ":::" sin div abierto (pandoc lo trata como texto literal)', () => {
    expect(looseColonLines(':::\n\n:::')).toEqual([1, 3]);
  });

  it('suma el offset de líneas del frontmatter (número de línea del archivo)', () => {
    expect(looseColonLines('texto\n\n:\n\ntexto', 3)).toEqual([6]);
    // Sin offset: las líneas son relativas al body
    expect(looseColonLines('texto\n\n:\n\ntexto')).toEqual([3]);
  });

  it('soporta fenced divs anidados (el cierre consuma profundidad)', () => {
    const body = '::: {.a}\n::: {.b}\ncontenido\n:::\n:::\n';
    expect(looseColonLines(body)).toEqual([]);
  });

  it('ignora los bloques de código (el delimitador y su contenido)', () => {
    expect(looseColonLines('```\n:\n::\n:::\n```\n')).toEqual([]);
    expect(looseColonLines('~~~\n:\n~~~\n')).toEqual([]);
    expect(looseColonLines('```lua\n::: {.dictum}\n```\n')).toEqual([]);
  });

  it('ignora los bloques de código dentro de fenced divs', () => {
    const body = '::: {.centered}\n```\n:\n```\n:::\n';
    expect(looseColonLines(body)).toEqual([]);
  });

  it('mantiene el conteo de líneas tras bloques de código', () => {
    const body = 'a\n```\n:\n```\nb\n\n:\n';
    expect(looseColonLines(body)).toEqual([7]);
  });
});

describe('looseColonsMessage', () => {
  it('formatea una línea (singular)', () => {
    expect(looseColonsMessage([3])).toBe('línea 3 con ":" suelta: ¿querías escribir "::" (espacio vertical) o ":;" (sin indentación)?');
  });

  it('formatea varias líneas (plural, lista)', () => {
    expect(looseColonsMessage([3, 7])).toBe('líneas 3, 7 con ":" suelta: ¿querías escribir "::" (espacio vertical) o ":;" (sin indentación)?');
  });
});
