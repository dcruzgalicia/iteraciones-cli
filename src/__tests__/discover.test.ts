import { describe, expect, it } from 'bun:test';
import { buildDocsFromIndex, computeSlug } from '../builder/discover.js';
import { type Frontmatter, isExportSkipped } from '../builder/types.js';

describe('computeSlug', () => {
  it('genera slug desde el título', () => {
    const result = computeSlug({ title: 'Mi Artículo de Prueba' });
    expect(result).toBe('mi-articulo-de-prueba');
  });

  it('incluye el primer autor cuando está presente', () => {
    const result = computeSlug({ title: 'Mi Artículo', author: ['Juan Pérez'] });
    expect(result).toBe('juan-perez-mi-articulo');
  });

  it('normaliza caracteres acentuados', () => {
    const result = computeSlug({ title: 'Canción para José' });
    expect(result).toBe('cancion-para-jose');
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
});

describe('parseAuthors', () => {
  // Prueba la logica de parseo de author del frontmatter
  // que acepta tanto string como array
  function parseAuthors(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw.filter((a: unknown): a is string => typeof a === 'string');
    }
    if (typeof raw === 'string' && raw.trim()) {
      return [raw.trim()];
    }
    return [];
  }

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
    expect(docs[0]?.frontmatter.title).toBe('');
    expect(docs[0]?.frontmatter.author).toEqual([]);
    expect(docs[0]?.frontmatter.date).toBe('');
    expect(docs[0]?.frontmatter.keywords).toEqual([]);
  });

  it('asigna filePath correcto', () => {
    const docs = buildDocsFromIndex(['sub/documento.md'], new Map(), '/raiz');
    expect(docs[0]?.filePath).toBe('/raiz/sub/documento.md');
  });
});

describe('isExportSkipped', () => {
  const baseFm: Frontmatter = { title: 'Test', date: '2024-01-01', author: [], keywords: [] };

  it('retorna false cuando no hay campo export', () => {
    expect(isExportSkipped(baseFm)).toBe(false);
  });

  it('retorna true cuando export.skip es true', () => {
    const fm: Frontmatter = { ...baseFm, export: { skip: true } };
    expect(isExportSkipped(fm)).toBe(true);
  });

  it('retorna false cuando export.skip es false', () => {
    const fm: Frontmatter = { ...baseFm, export: { skip: false } };
    expect(isExportSkipped(fm)).toBe(false);
  });

  it('retorna false cuando export no es un objeto', () => {
    const fm: Frontmatter = { ...baseFm, export: 'skip' as unknown as Record<string, unknown> };
    expect(isExportSkipped(fm)).toBe(false);
  });
});
