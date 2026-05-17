import { describe, expect, test } from 'bun:test';
import { tokenize } from '../lexer.js';
import { TokenType } from '../token-types.js';

describe('tokenize', () => {
  test('texto plano sin tokens produce un único TEXT', () => {
    const tokens = tokenize('hola mundo');
    expect(tokens).toEqual([{ type: TokenType.TEXT, value: 'hola mundo' }]);
  });

  test('string vacío produce array vacío', () => {
    expect(tokenize('')).toEqual([]);
  });

  test('VARIABLE simple', () => {
    const tokens = tokenize('$title$');
    expect(tokens).toEqual([{ type: TokenType.VARIABLE, value: 'title' }]);
  });

  test('VARIABLE con guion', () => {
    const tokens = tokenize('$site-title$');
    expect(tokens).toEqual([{ type: TokenType.VARIABLE, value: 'site-title' }]);
  });

  test('VARIABLE con punto (ruta dotted)', () => {
    const tokens = tokenize('$author.name$');
    expect(tokens).toEqual([{ type: TokenType.VARIABLE, value: 'author.name' }]);
  });

  test('IF con clave', () => {
    const tokens = tokenize('$if(show)$');
    expect(tokens).toEqual([{ type: TokenType.IF, value: 'show' }]);
  });

  test('ELSE', () => {
    expect(tokenize('$else$')).toEqual([{ type: TokenType.ELSE }]);
  });

  test('ENDIF', () => {
    expect(tokenize('$endif$')).toEqual([{ type: TokenType.ENDIF }]);
  });

  test('FOR con clave', () => {
    const tokens = tokenize('$for(items)$');
    expect(tokens).toEqual([{ type: TokenType.FOR, value: 'items' }]);
  });

  test('SEP', () => {
    expect(tokenize('$sep$')).toEqual([{ type: TokenType.SEP }]);
  });

  test('ENDFOR', () => {
    expect(tokenize('$endfor$')).toEqual([{ type: TokenType.ENDFOR }]);
  });

  test('ESCAPE $$ produce un único token ESCAPE', () => {
    expect(tokenize('$$')).toEqual([{ type: TokenType.ESCAPE }]);
  });

  test('texto antes y después de una variable', () => {
    const tokens = tokenize('Hola $name$!');
    expect(tokens).toEqual([
      { type: TokenType.TEXT, value: 'Hola ' },
      { type: TokenType.VARIABLE, value: 'name' },
      { type: TokenType.TEXT, value: '!' },
    ]);
  });

  test('$ sin cierre trata el resto como TEXT', () => {
    const tokens = tokenize('texto $sin-cierre');
    expect(tokens).toEqual([{ type: TokenType.TEXT, value: 'texto $sin-cierre' }]);
  });

  test('múltiples variables contiguas', () => {
    const tokens = tokenize('$a$$b$');
    expect(tokens).toEqual([
      { type: TokenType.VARIABLE, value: 'a' },
      { type: TokenType.VARIABLE, value: 'b' },
    ]);
  });

  test('ESCAPE en medio de texto', () => {
    const tokens = tokenize('precio: $$5');
    expect(tokens).toEqual([{ type: TokenType.TEXT, value: 'precio: ' }, { type: TokenType.ESCAPE }, { type: TokenType.TEXT, value: '5' }]);
  });

  test('IF con espacios en la clave los recorta', () => {
    const tokens = tokenize('$if( key )$');
    expect(tokens).toEqual([{ type: TokenType.IF, value: 'key' }]);
  });

  test('FOR con espacios en la clave los recorta', () => {
    const tokens = tokenize('$for( items )$');
    expect(tokens).toEqual([{ type: TokenType.FOR, value: 'items' }]);
  });
});
