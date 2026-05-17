import { describe, expect, test } from 'bun:test';
import { tokenize } from '../lexer.js';
import { parse } from '../parser.js';

/** Helper: tokeniza y parsea en un paso. */
function p(template: string) {
  return parse(tokenize(template));
}

describe('parse', () => {
  test('string vacío produce array vacío', () => {
    expect(p('')).toEqual([]);
  });

  test('texto plano produce un nodo text', () => {
    expect(p('hola')).toEqual([{ kind: 'text', value: 'hola' }]);
  });

  test('variable simple', () => {
    expect(p('$title$')).toEqual([{ kind: 'variable', key: 'title' }]);
  });

  test('ESCAPE produce nodo text con "$"', () => {
    expect(p('$$')).toEqual([{ kind: 'text', value: '$' }]);
  });

  test('if sin else', () => {
    const nodes = p('$if(show)$sí$endif$');
    expect(nodes).toEqual([
      {
        kind: 'if',
        condition: 'show',
        consequent: [{ kind: 'text', value: 'sí' }],
        alternate: [],
      },
    ]);
  });

  test('if con else', () => {
    const nodes = p('$if(show)$sí$else$no$endif$');
    expect(nodes).toEqual([
      {
        kind: 'if',
        condition: 'show',
        consequent: [{ kind: 'text', value: 'sí' }],
        alternate: [{ kind: 'text', value: 'no' }],
      },
    ]);
  });

  test('for sin sep', () => {
    const nodes = p('$for(items)$$name$$endfor$');
    expect(nodes).toEqual([
      {
        kind: 'for',
        key: 'items',
        body: [{ kind: 'variable', key: 'name' }],
        separator: [],
      },
    ]);
  });

  test('for con sep', () => {
    const nodes = p('$for(items)$$name$$sep$, $endfor$');
    expect(nodes).toEqual([
      {
        kind: 'for',
        key: 'items',
        body: [{ kind: 'variable', key: 'name' }],
        separator: [{ kind: 'text', value: ', ' }],
      },
    ]);
  });

  test('if anidado dentro de for', () => {
    const nodes = p('$for(items)$$if(active)$$name$$endif$$endfor$');
    expect(nodes).toEqual([
      {
        kind: 'for',
        key: 'items',
        body: [
          {
            kind: 'if',
            condition: 'active',
            consequent: [{ kind: 'variable', key: 'name' }],
            alternate: [],
          },
        ],
        separator: [],
      },
    ]);
  });

  test('for anidado dentro de if', () => {
    const nodes = p('$if(list)$$for(list)$$x$$endfor$$endif$');
    expect(nodes).toEqual([
      {
        kind: 'if',
        condition: 'list',
        consequent: [
          {
            kind: 'for',
            key: 'list',
            body: [{ kind: 'variable', key: 'x' }],
            separator: [],
          },
        ],
        alternate: [],
      },
    ]);
  });

  test('token de cierre inesperado en raíz lanza error', () => {
    expect(() => p('$endif$')).toThrow('inesperado');
  });

  test('múltiples nodos al mismo nivel', () => {
    const nodes = p('$a$ y $b$');
    expect(nodes).toEqual([
      { kind: 'variable', key: 'a' },
      { kind: 'text', value: ' y ' },
      { kind: 'variable', key: 'b' },
    ]);
  });
});
