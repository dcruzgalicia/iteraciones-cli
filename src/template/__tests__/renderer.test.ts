import { describe, expect, test } from 'bun:test';
import { tokenize } from '../lexer.js';
import { parse } from '../parser.js';
import { renderAst } from '../render/renderer.js';

/** Helper: tokeniza, parsea y renderiza en un paso. */
function render(template: string, ctx: Record<string, unknown> = {}): string {
  return renderAst(parse(tokenize(template)), ctx);
}

describe('renderAst — variables', () => {
  test('variable simple interpolada', () => {
    expect(render('Hola $name$!', { name: 'Ana' })).toBe('Hola Ana!');
  });

  test('variable inexistente produce cadena vacía', () => {
    expect(render('$missing$', {})).toBe('');
  });

  test('variable dotted', () => {
    expect(render('$author.name$', { author: { name: 'Bea' } })).toBe('Bea');
  });

  test('ESCAPE $$ produce "$" literal', () => {
    expect(render('precio: $$10', {})).toBe('precio: $10');
  });

  test('texto plano sin tokens', () => {
    expect(render('sin variables', {})).toBe('sin variables');
  });
});

describe('renderAst — condicionales', () => {
  test('if truthy renderiza consecuente', () => {
    expect(render('$if(show)$sí$endif$', { show: true })).toBe('sí');
  });

  test('if falsy no renderiza nada sin else', () => {
    expect(render('$if(show)$sí$endif$', { show: false })).toBe('');
  });

  test('if falsy renderiza alternativo con else', () => {
    expect(render('$if(show)$sí$else$no$endif$', { show: false })).toBe('no');
  });

  test('array vacío es falsy en if', () => {
    expect(render('$if(items)$hay items$else$vacío$endif$', { items: [] })).toBe('vacío');
  });

  test('array con elementos es truthy en if', () => {
    expect(render('$if(items)$hay items$endif$', { items: ['a'] })).toBe('hay items');
  });

  test('string vacío es falsy', () => {
    expect(render('$if(val)$sí$else$no$endif$', { val: '' })).toBe('no');
  });

  test('if con clave inexistente es falsy', () => {
    expect(render('$if(missing)$sí$else$no$endif$', {})).toBe('no');
  });
});

describe('renderAst — bucles', () => {
  test('for sobre array de strings', () => {
    expect(render('$for(tags)$$tags$$endfor$', { tags: ['a', 'b', 'c'] })).toBe('abc');
  });

  test('for con sep inserta separador entre items', () => {
    expect(render('$for(tags)$$tags$$sep$, $endfor$', { tags: ['a', 'b', 'c'] })).toBe('a, b, c');
  });

  test('for sobre array vacío no renderiza nada', () => {
    expect(render('$for(items)$$name$$endfor$', { items: [] })).toBe('');
  });

  test('for sobre array de objetos accede a sus propiedades', () => {
    const result = render('$for(people)$$name$$sep$, $endfor$', {
      people: [{ name: 'Ana' }, { name: 'Bea' }],
    });
    expect(result).toBe('Ana, Bea');
  });

  test('for sobre un primitivo único lo itera una vez', () => {
    expect(render('$for(tag)$$tag$$endfor$', { tag: 'único' })).toBe('único');
  });

  test('el scope padre sigue accesible dentro del body del for', () => {
    const result = render('$for(items)$$prefix$$name$$endfor$', {
      prefix: '- ',
      items: [{ name: 'A' }, { name: 'B' }],
    });
    expect(result).toBe('- A- B');
  });

  test('el item del for no contamina el scope padre tras el bucle', () => {
    // Después del $endfor$, $name$ debe resolverse desde el contexto raíz
    const result = render('$for(items)$$name$$endfor$|$name$', {
      name: 'raíz',
      items: [{ name: 'iter' }],
    });
    expect(result).toBe('iter|raíz');
  });
});

describe('renderAst — anidamiento', () => {
  test('if dentro de for', () => {
    const result = render('$for(items)$$if(active)$$name$$endif$$sep$,$endfor$', {
      items: [
        { name: 'A', active: true },
        { name: 'B', active: false },
        { name: 'C', active: true },
      ],
    });
    expect(result).toBe('A,,C');
  });

  test('for dentro de if', () => {
    const result = render('$if(items)$$for(items)$$x$$sep$,$endfor$$endif$', {
      items: [{ x: '1' }, { x: '2' }],
    });
    expect(result).toBe('1,2');
  });
});
