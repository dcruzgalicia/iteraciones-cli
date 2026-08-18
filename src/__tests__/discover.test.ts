import { describe, expect, it } from 'bun:test';
import { buildDocsFromIndex, computeSlug, htmlSlugFor, parseAuthors } from '../builder/discover.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';

describe('computeSlug', () => {
  it('genera slug desde el título', () => {
    const result = computeSlug({ title: 'Mi Artículo de Prueba' });
    expect(result).toBe('mi-articulo-de-prueba');
  });

  it('incluye el primer autor: title-por-author', () => {
    const result = computeSlug({ title: 'Mi Artículo', author: ['Juan Pérez'] });
    expect(result).toBe('mi-articulo-por-juan-perez');
  });

  it('usa solo el primer autor por defecto', () => {
    const result = computeSlug({
      title: 'Mi Artículo',
      author: ['Sofia García', 'Juan Pérez', 'Ana López'],
    });
    expect(result).toBe('mi-articulo-por-sofia-garcia');
  });

  it('permite expandir autores con maxAuthors', () => {
    const result = computeSlug({ title: 'Test', author: ['A', 'B', 'C'] }, { maxAuthors: 3 });
    expect(result).toBe('test-por-a-y-b-y-c');
  });

  it('usa 2 autores cuando se especifica maxAuthors', () => {
    const result = computeSlug({ title: 'Doc', author: ['Ana', 'Luis'] }, { maxAuthors: 2 });
    expect(result).toBe('doc-por-ana-y-luis');
  });

  it('normaliza caracteres acentuados', () => {
    const result = computeSlug({ title: 'Canción para José' });
    expect(result).toBe('cancion-para-jose');
  });

  it('mapea símbolos al español: & → y, % → por-ciento', () => {
    expect(computeSlug({ title: 'Diseño & Desarrollo' })).toBe('diseno-y-desarrollo');
    expect(computeSlug({ title: 'Resultados 100%' })).toBe('resultados-100-por-ciento');
  });

  it('retorna undefined si no hay título', () => {
    const result = computeSlug({});
    expect(result).toBeUndefined();
  });

  it('retorna undefined si el título es empty string', () => {
    const result = computeSlug({ title: '' });
    expect(result).toBeUndefined();
  });

  it('ignora autores vacíos', () => {
    const result = computeSlug({ title: 'Test', author: [] });
    expect(result).toBe('test');
  });

  it('limpia guiones duplicados y extremos', () => {
    const result = computeSlug({ title: '  Hola!!!   Mundo... ' });
    expect(result).toBe('hola-mundo');
  });

  it('usa el nombre del archivo como base cuando no hay título y se provee fallbackPath', () => {
    const result = computeSlug({}, { fallbackPath: 'posts/mi-articulo.md' });
    expect(result).toBe('mi-articulo');
  });

  it('genera filename-by-author con fallbackPath y autor', () => {
    const result = computeSlug({ author: ['Juan Pérez'] }, { fallbackPath: 'notas/apuntes.md' });
    expect(result).toBe('apuntes-por-juan-perez');
  });

  it('con fallbackPath siempre retorna string (incluso con título vacío)', () => {
    const result = computeSlug({ title: '' }, { fallbackPath: 'sub/documento.md' });
    expect(result).toBe('documento');
  });

  it('retorna undefined sin título ni fallbackPath', () => {
    const result = computeSlug({});
    expect(result).toBeUndefined();
  });
});

describe('htmlSlugFor', () => {
  it('retorna index para un archivo index.md en la raíz', () => {
    expect(htmlSlugFor('index.md', 'mi-titulo-por-autor')).toBe('index');
  });

  it('retorna index para un index.md en subdirectorio', () => {
    expect(htmlSlugFor('posts/index.md', 'mi-titulo-por-autor')).toBe('index');
  });

  it('retorna el slug normal para otros archivos', () => {
    expect(htmlSlugFor('posts/mi-articulo.md', 'mi-articulo-por-autor')).toBe('mi-articulo-por-autor');
  });

  it('usa el nombre del archivo si no hay slug', () => {
    expect(htmlSlugFor('posts/nota.md', undefined)).toBe('nota');
    expect(htmlSlugFor('index.md', undefined)).toBe('index');
  });
});

describe('parseAuthors', () => {
  it('acepta string simple', () => {
    expect(parseAuthors('Sofia García')).toEqual(['Sofia García']);
  });

  it('acepta array con un elemento', () => {
    expect(parseAuthors(['Sofia García'])).toEqual(['Sofia García']);
  });

  it('acepta array con multiples elementos', () => {
    expect(parseAuthors(['Sofia García', 'Juan Pérez'])).toEqual(['Sofia García', 'Juan Pérez']);
  });

  it('retorna array vacio para string vacio', () => {
    expect(parseAuthors('')).toEqual([]);
  });

  it('retorna array vacio si no hay author', () => {
    expect(parseAuthors(undefined)).toEqual([]);
  });

  it('retorna array vacio para null', () => {
    expect(parseAuthors(null)).toEqual([]);
  });

  it('filtra elementos no-string en arrays mixtos', () => {
    expect(parseAuthors(['Sofia', 123, 'Juan'])).toEqual(['Sofia', 'Juan']);
  });
});

describe('buildDocsFromIndex', () => {
  it('construye BuildDocument[] desde paths e index', () => {
    const paths = ['a.md', 'b.md'];
    const index = new Map([
      ['a.md', { title: 'Artículo A', author: ['Autor1'] }],
      ['b.md', { title: 'Artículo B', author: ['Autor2'] }],
    ]);
    const docs = buildDocsFromIndex(paths, index, '/proyecto');
    expect(docs).toHaveLength(2);
    expect(docs[0]?.relativePath).toBe('a.md');
    expect(docs[0]?.frontmatter.title).toBe('Artículo A');
    expect(docs[0]?.frontmatter.author).toEqual(['Autor1']);
    expect(docs[1]?.relativePath).toBe('b.md');
    expect(docs[1]?.frontmatter.title).toBe('Artículo B');
  });

  it('usa valores por defecto cuando no hay entrada en el index', () => {
    const docs = buildDocsFromIndex(['x.md'], new Map(), '/proyecto');
    expect(docs[0]?.frontmatter.title).toBe('Sin título');
    expect(docs[0]?.frontmatter.author).toEqual([]);
    expect(docs[0]?.frontmatter.date).toBe('');
  });

  it('asigna filePath correcto', () => {
    const docs = buildDocsFromIndex(['sub/documento.md'], new Map(), '/raiz');
    expect(docs[0]?.filePath).toBe('/raiz/sub/documento.md');
  });
});

describe('splitFrontmatter', () => {
  it('separa el YAML del body', () => {
    const { yaml, body } = splitFrontmatter('---\ntitle: Prueba\n---\n\nContenido');
    expect(yaml).toBe('title: Prueba');
    expect(body).toBe('\nContenido');
  });

  it('retorna body completo sin yaml si no hay frontmatter', () => {
    const { yaml, body } = splitFrontmatter('Contenido sin frontmatter');
    expect(yaml).toBeUndefined();
    expect(body).toBe('Contenido sin frontmatter');
  });

  it('maneja frontmatter al final del archivo sin newline final', () => {
    const { yaml, body } = splitFrontmatter('---\ntitle: Fin\n---');
    expect(yaml).toBe('title: Fin');
    expect(body).toBe('');
  });

  it('no confunde un bloque --- interno con frontmatter', () => {
    const { yaml, body } = splitFrontmatter('---\ntitle: Prueba\n---\n\n---\nno es frontmatter\n---');
    expect(yaml).toBe('title: Prueba');
    expect(body).toBe('\n---\nno es frontmatter\n---');
  });

  it('soporta saltos de línea CRLF', () => {
    const { yaml, body } = splitFrontmatter('---\r\ntitle: Prueba\r\n---\r\n\r\nContenido');
    expect(yaml).toBe('title: Prueba');
    expect(body).toBe('\r\nContenido');
  });
});

describe('parseYamlWithPosition', () => {
  it('reporta causa y posición en una sola línea (sin snippet ni caret)', () => {
    const result = parseYamlWithPosition('lang: [unclosed');
    expect(result.value).toBeUndefined();
    expect(result.error).toMatch(/^[^\n]+ \(línea 1, columna \d+\)$/);
    expect(result.error).not.toContain('\n');
    // La posición de la librería no se duplica
    expect(result.error).not.toContain('at line');
  });

  it('retorna el valor parseado para YAML válido', () => {
    const result = parseYamlWithPosition('lang: es-MX\ntoc: true');
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({ lang: 'es-MX', toc: true });
  });

  it('traduce a español las causas conocidas de la librería (frontmatter de documento)', () => {
    expect(parseYamlWithPosition('title: A\ntitle: B\n').error).toContain('las claves del mapeo deben ser únicas');
    expect(parseYamlWithPosition('title: [roto\n').error).toContain('la secuencia de flujo debe estar bien indentada');
    expect(parseYamlWithPosition('title: "sin cerrar\n').error).toContain('falta la comilla de cierre');
  });
});
