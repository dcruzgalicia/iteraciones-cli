import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { assembleExportDocument, resolveItemsForExport } from '../export/assemble.js';
import type { BuildDocument } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers para construir BuildDocuments mínimos en tests
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<BuildDocument> & { type: BuildDocument['type'] }): BuildDocument {
  return {
    filePath: '/project/index.md',
    relativePath: 'index.md',
    frontmatter: {
      title: 'Documento de prueba',
      date: '2025-01-01',
      author: ['Autor A'],
      speakers: [],
      type: overrides.type ?? 'file',
      keywords: [],
      region: '',
      block: false,
      draft: false,
      items: [],
    },
    body: 'Cuerpo del documento.',
    sourceHash: 'a'.repeat(64),
    mtimeMs: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Renaming de footnotes
// ---------------------------------------------------------------------------

describe('assembleBookBody — renaming de footnotes', () => {
  test('prefija [^N] con el slug del archivo fuente', () => {
    const collection = makeDoc({
      type: 'collection',
      filePath: '/project/coleccion.md',
      relativePath: 'coleccion.md',
      frontmatter: {
        title: 'Colección',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: ['notas/articulo-a.md', 'notas/articulo-b.md'],
      },
      body: '',
    });

    const itemA = makeDoc({
      type: 'file',
      filePath: '/project/notas/articulo-a.md',
      relativePath: 'notas/articulo-a.md',
      frontmatter: {
        title: 'Artículo A',
        date: '',
        author: ['Autor A'],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: 'Texto con nota[^1].\n\n[^1]: Definición de nota uno.',
    });

    const itemB = makeDoc({
      type: 'file',
      filePath: '/project/notas/articulo-b.md',
      relativePath: 'notas/articulo-b.md',
      frontmatter: {
        title: 'Artículo B',
        date: '',
        author: ['Autor B'],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: 'Texto con nota[^1].\n\n[^1]: Definición de nota dos.',
    });

    const exportDoc = assembleExportDocument(collection, [itemA, itemB], 'es', '/project');
    expect(exportDoc).not.toBeNull();
    const body = exportDoc!.body;

    // Las referencias de A deben tener el slug del archivo A
    expect(body).toContain('[^notas-articulo-a-1]');
    // Las referencias de B deben tener el slug del archivo B
    expect(body).toContain('[^notas-articulo-b-1]');
    // No debe quedar ningún [^1] sin prefijo
    expect(body).not.toMatch(/\[\^1\]/);
  });

  test('dos artículos con la misma footnote producen IDs distintos', () => {
    const collection = makeDoc({
      type: 'collection',
      filePath: '/project/col.md',
      relativePath: 'col.md',
      frontmatter: {
        title: 'Col',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: ['a.md', 'b.md'],
      },
      body: '',
    });

    const docA = makeDoc({
      type: 'file',
      filePath: '/project/a.md',
      relativePath: 'a.md',
      frontmatter: { ...makeDoc({ type: 'file' }).frontmatter, title: 'A', items: [] },
      body: '[^abc].\n\n[^abc]: Nota.',
    });

    const docB = makeDoc({
      type: 'file',
      filePath: '/project/b.md',
      relativePath: 'b.md',
      frontmatter: { ...makeDoc({ type: 'file' }).frontmatter, title: 'B', items: [] },
      body: '[^abc].\n\n[^abc]: Nota.',
    });

    const exportDoc = assembleExportDocument(collection, [docA, docB], 'es', '/project');
    expect(exportDoc).not.toBeNull();
    const body = exportDoc!.body;

    expect(body).toContain('[^a-abc]');
    expect(body).toContain('[^b-abc]');
  });
});

// ---------------------------------------------------------------------------
// Separadores de capítulo para scrbook
// ---------------------------------------------------------------------------

describe('assembleBookBody — separadores de capítulo', () => {
  function makeCollection(itemPaths: string[]): BuildDocument {
    return makeDoc({
      type: 'collection',
      filePath: '/project/coleccion.md',
      relativePath: 'coleccion.md',
      frontmatter: {
        title: 'Colección',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: itemPaths,
      },
      body: '',
    });
  }

  test('incluye # Título del capítulo antes del body de cada item', () => {
    const item = makeDoc({
      type: 'file',
      filePath: '/project/articulo.md',
      relativePath: 'articulo.md',
      frontmatter: {
        title: 'Mi artículo',
        date: '',
        author: ['Ana'],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: 'Cuerpo.',
    });

    const exportDoc = assembleExportDocument(makeCollection(['articulo.md']), [item], 'es', '/project');
    expect(exportDoc!.body).toContain('# Mi artículo');
  });

  test('incluye *Por Autor* para ítems tipo file', () => {
    const item = makeDoc({
      type: 'file',
      filePath: '/project/articulo.md',
      relativePath: 'articulo.md',
      frontmatter: {
        title: 'Artículo',
        date: '',
        author: ['Ana Pérez'],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: 'Texto.',
    });

    const exportDoc = assembleExportDocument(makeCollection(['articulo.md']), [item], 'es', '/project');
    expect(exportDoc!.body).toContain('*Por Ana Pérez*');
  });

  test('omite *Por Autor* para ítems de tipo author (sería redundante)', () => {
    const item = makeDoc({
      type: 'author',
      filePath: '/project/personas/ana.md',
      relativePath: 'personas/ana.md',
      frontmatter: {
        title: 'Ana Pérez',
        date: '',
        author: ['Ana Pérez'],
        speakers: [],
        type: 'author',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: 'Semblanza.',
    });

    const exportDoc = assembleExportDocument(makeCollection(['personas/ana.md']), [item], 'es', '/project');
    const body = exportDoc!.body;
    expect(body).toContain('# Ana Pérez');
    expect(body).not.toContain('*Por Ana Pérez*');
  });

  test('incluye directiva \\newpage al final de cada capítulo', () => {
    const item = makeDoc({
      type: 'file',
      filePath: '/project/cap.md',
      relativePath: 'cap.md',
      frontmatter: {
        title: 'Capítulo',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: 'Contenido.',
    });

    const exportDoc = assembleExportDocument(makeCollection(['cap.md']), [item], 'es', '/project');
    expect(exportDoc!.body).toContain('\\newpage');
  });
});

// ---------------------------------------------------------------------------
// Resolución de rutas de imágenes
// ---------------------------------------------------------------------------

describe('assembleBookBody — resolución de rutas de imágenes', () => {
  test('convierte rutas relativas a absolutas usando el directorio del archivo fuente', () => {
    const collection = makeDoc({
      type: 'collection',
      filePath: '/project/coleccion.md',
      relativePath: 'coleccion.md',
      frontmatter: {
        title: 'Col',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: ['notas/articulo.md'],
      },
      body: '',
    });

    const item = makeDoc({
      type: 'file',
      filePath: '/project/notas/articulo.md',
      relativePath: 'notas/articulo.md',
      frontmatter: {
        title: 'Artículo',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: '![logo](./img/logo.png)',
    });

    const exportDoc = assembleExportDocument(collection, [item], 'es', '/project');
    expect(exportDoc!.body).toContain('/project/notas/img/logo.png');
    // La ruta relativa original no debe aparecer
    expect(exportDoc!.body).not.toContain('./img/logo.png');
  });

  test('no modifica rutas absolutas', () => {
    const collection = makeDoc({
      type: 'collection',
      filePath: '/project/col.md',
      relativePath: 'col.md',
      frontmatter: {
        title: 'Col',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: ['art.md'],
      },
      body: '',
    });

    const item = makeDoc({
      type: 'file',
      filePath: '/project/art.md',
      relativePath: 'art.md',
      frontmatter: {
        title: 'Art',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: '![img](/absolute/path/img.png)',
    });

    const exportDoc = assembleExportDocument(collection, [item], 'es', '/project');
    expect(exportDoc!.body).toContain('/absolute/path/img.png');
  });

  test('no modifica URLs http/https', () => {
    const collection = makeDoc({
      type: 'collection',
      filePath: '/project/col.md',
      relativePath: 'col.md',
      frontmatter: {
        title: 'Col',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: ['art.md'],
      },
      body: '',
    });

    const item = makeDoc({
      type: 'file',
      filePath: '/project/art.md',
      relativePath: 'art.md',
      frontmatter: {
        title: 'Art',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: '![img](https://example.com/img.png)',
    });

    const exportDoc = assembleExportDocument(collection, [item], 'es', '/project');
    expect(exportDoc!.body).toContain('https://example.com/img.png');
  });
});

// ---------------------------------------------------------------------------
// assembleExportDocument — tipos scrartcl (file, event, author)
// ---------------------------------------------------------------------------

describe('assembleExportDocument — tipos scrartcl', () => {
  test('retorna el body sin modificar para type: file', () => {
    const doc = makeDoc({ type: 'file', body: 'Contenido original.' });
    const exportDoc = assembleExportDocument(doc, [], 'es', '/project');
    expect(exportDoc).not.toBeNull();
    expect(exportDoc!.body).toBe('Contenido original.');
    expect(exportDoc!.metadata.documentclass).toBe('scrartcl');
  });

  test('retorna null para un tipo no exportable (block)', () => {
    const doc = makeDoc({ type: undefined });
    const exportDoc = assembleExportDocument(doc, [], 'es', '/project');
    expect(exportDoc).toBeNull();
  });

  test('usa el lang del sitio en los metadatos', () => {
    const doc = makeDoc({ type: 'file' });
    const exportDoc = assembleExportDocument(doc, [], 'es-MX', '/project');
    expect(exportDoc!.metadata.lang).toBe('es-MX');
  });

  test('usa scrbook para type: collection', () => {
    const collection = makeDoc({
      type: 'collection',
      frontmatter: {
        title: 'Colección',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
    });
    const exportDoc = assembleExportDocument(collection, [], 'es', '/project');
    expect(exportDoc!.metadata.documentclass).toBe('scrbook');
    expect(exportDoc!.metadata.toc).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveItemsForExport
// ---------------------------------------------------------------------------

describe('resolveItemsForExport', () => {
  test('resuelve items en el orden declarado en frontmatter.items', () => {
    const collection = makeDoc({
      type: 'collection',
      frontmatter: {
        title: 'Col',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: ['b.md', 'a.md'],
      },
    });

    const docA = makeDoc({ type: 'file', relativePath: 'a.md' });
    const docB = makeDoc({ type: 'file', relativePath: 'b.md' });

    const resolved = resolveItemsForExport(collection, [docA, docB]);
    expect(resolved[0]?.relativePath).toBe('b.md');
    expect(resolved[1]?.relativePath).toBe('a.md');
  });

  test('omite items no encontrados en el pool', () => {
    const collection = makeDoc({
      type: 'collection',
      frontmatter: {
        title: 'Col',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: ['existe.md', 'no-existe.md'],
      },
    });

    const docExiste = makeDoc({ type: 'file', relativePath: 'existe.md' });
    const resolved = resolveItemsForExport(collection, [docExiste]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.relativePath).toBe('existe.md');
  });

  test('retorna array vacío si el documento no es tipo collection', () => {
    const doc = makeDoc({ type: 'file' });
    expect(resolveItemsForExport(doc, [])).toHaveLength(0);
  });
});
