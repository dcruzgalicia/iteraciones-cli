import { describe, expect, test } from 'bun:test';
import { tokenize } from '../lexer.js';
import { parse } from '../parser.js';
import { renderAst } from '../render/renderer.js';

/**
 * Tests de integración: templates completos similares a los que
 * se usan en producción (card.html, default.html, etc.).
 */

function render(template: string, ctx: Record<string, unknown>): string {
  return renderAst(parse(tokenize(template)), ctx);
}

describe('integración — template de página simple', () => {
  const pageTemplate = `<!DOCTYPE html>
<html>
<head><title>$site-title$ — $title$</title></head>
<body>
$if(description)$<meta name="description" content="$description$">$endif$
<h1>$title$</h1>
$body$
</body>
</html>`;

  test('renderiza página con todos los campos', () => {
    const ctx = {
      'site-title': 'Mi Sitio',
      title: 'Inicio',
      description: 'Una descripción',
      body: '<p>Contenido</p>',
    };
    const result = render(pageTemplate, ctx);
    expect(result).toContain('<title>Mi Sitio — Inicio</title>');
    expect(result).toContain('<meta name="description" content="Una descripción">');
    expect(result).toContain('<h1>Inicio</h1>');
    expect(result).toContain('<p>Contenido</p>');
  });

  test('omite meta description cuando no hay descripción', () => {
    const ctx = {
      'site-title': 'Mi Sitio',
      title: 'Inicio',
      body: '<p>Contenido</p>',
    };
    const result = render(pageTemplate, ctx);
    expect(result).not.toContain('meta name="description"');
  });
});

describe('integración — template de navegación con lista', () => {
  const navTemplate = `<nav>$for(nav-items)$<a href="$href$">$label$</a>$sep$ | $endfor$</nav>`;

  test('renderiza lista de links con separador', () => {
    const ctx = {
      'nav-items': [
        { href: '/inicio', label: 'Inicio' },
        { href: '/blog', label: 'Blog' },
        { href: '/contacto', label: 'Contacto' },
      ],
    };
    const result = render(navTemplate, ctx);
    expect(result).toBe('<nav><a href="/inicio">Inicio</a> | <a href="/blog">Blog</a> | <a href="/contacto">Contacto</a></nav>');
  });

  test('nav vacío produce solo el wrapper', () => {
    const result = render(navTemplate, { 'nav-items': [] });
    expect(result).toBe('<nav></nav>');
  });
});

describe('integración — template de tarjeta con campos opcionales', () => {
  const cardTemplate = `<article>
<h2>$title$</h2>
$if(author)$<p class="author">$author$</p>$endif$
$if(tags)$<ul>$for(tags)$<li>$tags$</li>$endfor$</ul>$endif$
$if(excerpt)$<p>$excerpt$</p>$else$<p>Sin resumen.</p>$endif$
</article>`;

  test('renderiza tarjeta completa', () => {
    const ctx = {
      title: 'Artículo',
      author: 'Ana',
      tags: ['TypeScript', 'Bun'],
      excerpt: 'Un artículo interesante.',
    };
    const result = render(cardTemplate, ctx);
    expect(result).toContain('<h2>Artículo</h2>');
    expect(result).toContain('<p class="author">Ana</p>');
    expect(result).toContain('<li>TypeScript</li>');
    expect(result).toContain('<li>Bun</li>');
    expect(result).toContain('<p>Un artículo interesante.</p>');
    expect(result).not.toContain('Sin resumen.');
  });

  test('renderiza tarjeta mínima con fallbacks', () => {
    const ctx = { title: 'Solo título' };
    const result = render(cardTemplate, ctx);
    expect(result).toContain('<h2>Solo título</h2>');
    expect(result).not.toContain('class="author"');
    expect(result).not.toContain('<ul>');
    expect(result).toContain('Sin resumen.');
  });
});

describe('integración — escape de símbolo dollar', () => {
  test('$$ en template produce $ en output', () => {
    expect(render('Precio: $$100', {})).toBe('Precio: $100');
  });

  test('$$ no interpola la variable siguiente', () => {
    expect(render('$$title$', { title: 'valor' })).toBe('$title$');
  });
});
