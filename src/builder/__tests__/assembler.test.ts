import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { assembleAuthorExportVariants, assembleExportDocument, resolveItemsForExport, resolvePartsForExport } from '../export/assemble.js';
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

// ---------------------------------------------------------------------------
// assembleExportDocument — campos template, abstract y keywords
// ---------------------------------------------------------------------------

describe('assembleExportDocument — template / abstract / keywords', () => {
  test('editorial.template válido se propaga a metadata.template', () => {
    const doc = makeDoc({
      type: 'file',
      frontmatter: {
        title: 'Doc',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
        editorial: { template: 'literary' },
      },
    });
    const result = assembleExportDocument(doc, [], 'es', '/project');
    expect(result!.metadata.template).toBe('literary');
  });

  test('editorial.template inválido produce metadata.template === undefined', () => {
    const doc = makeDoc({
      type: 'file',
      frontmatter: {
        title: 'Doc',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
        editorial: { template: 'novelita' },
      },
    });
    const result = assembleExportDocument(doc, [], 'es', '/project');
    expect(result!.metadata.template).toBeUndefined();
  });

  test('globalTemplate se usa como fallback cuando el frontmatter no define template', () => {
    const doc = makeDoc({ type: 'file' });
    const result = assembleExportDocument(doc, [], 'es', '/project', undefined, undefined, 'academic');
    expect(result!.metadata.template).toBe('academic');
  });

  test('editorial.template sobreescribe globalTemplate', () => {
    const doc = makeDoc({
      type: 'file',
      frontmatter: {
        title: 'Doc',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
        editorial: { template: 'literary' },
      },
    });
    const result = assembleExportDocument(doc, [], 'es', '/project', undefined, undefined, 'academic');
    expect(result!.metadata.template).toBe('literary');
  });

  test('editorial.abstract se propaga a metadata.abstract', () => {
    const doc = makeDoc({
      type: 'file',
      frontmatter: {
        title: 'Doc',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
        editorial: { abstract: 'Resumen del artículo.' },
      },
    });
    const result = assembleExportDocument(doc, [], 'es', '/project');
    expect(result!.metadata.abstract).toBe('Resumen del artículo.');
  });

  test('editorial.keywords se propaga a metadata.keywords', () => {
    const doc = makeDoc({
      type: 'file',
      frontmatter: {
        title: 'Doc',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
        editorial: { keywords: ['diseño', 'tipografía'] },
      },
    });
    const result = assembleExportDocument(doc, [], 'es', '/project');
    expect(result!.metadata.keywords).toEqual(['diseño', 'tipografía']);
  });

  test('editorial.keywords filtra valores no string', () => {
    const doc = makeDoc({
      type: 'file',
      frontmatter: {
        title: 'Doc',
        date: '',
        author: [],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
        editorial: { keywords: ['css', 42, null, 'accesibilidad'] },
      },
    });
    const result = assembleExportDocument(doc, [], 'es', '/project');
    expect(result!.metadata.keywords).toEqual(['css', 'accesibilidad']);
  });
});

// ---------------------------------------------------------------------------
// assembleAuthorExportVariants
// ---------------------------------------------------------------------------

describe('assembleAuthorExportVariants', () => {
  function makeAuthorDoc(overrides: Partial<BuildDocument> = {}): BuildDocument {
    return makeDoc({
      type: 'author',
      filePath: '/project/personas/ana-lopez.md',
      relativePath: 'personas/ana-lopez.md',
      frontmatter: {
        title: 'Ana López',
        date: '2024-01-01',
        author: ['Ana López'],
        speakers: [],
        type: 'author',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
        tagline: 'Escritora y periodista',
        location: 'Ciudad de México',
        email: 'ana@example.com',
        skills: ['Narrativa', 'Crónica'],
        training: ['Licenciatura en Comunicación'],
        interests: ['Literatura latinoamericana'],
        languages: ['Español (nativo)', 'Inglés (B2)'],
        ...((overrides.frontmatter ?? {}) as object),
      },
      body: 'Ana López es escritora con más de diez años de experiencia.',
      ...overrides,
    });
  }

  function makeFileDoc(authorName: string, title: string, date: string, body = '', abstract = ''): BuildDocument {
    return makeDoc({
      type: 'file',
      filePath: `/project/textos/${title.toLowerCase().replace(/ /g, '-')}.md`,
      relativePath: `textos/${title.toLowerCase().replace(/ /g, '-')}.md`,
      frontmatter: {
        title,
        date,
        author: [authorName],
        speakers: [],
        type: 'file',
        keywords: ['narrativa', 'ficción'],
        region: '',
        block: false,
        draft: false,
        items: [],
        abstract: abstract || `Resumen de ${title}.`,
      },
      body: body || `Cuerpo de ${title}.`,
    });
  }

  test('genera dos variantes con relativePath correcto', () => {
    const author = makeAuthorDoc();
    const { summary, full } = assembleAuthorExportVariants(author, [], 'es', '/project');
    expect(summary.relativePath).toBe('personas/ana-lopez.md');
    expect(full.relativePath).toBe('personas/ana-lopez-completo.md');
  });

  test('filePath es el mismo en ambas variantes', () => {
    const author = makeAuthorDoc();
    const { summary, full } = assembleAuthorExportVariants(author, [], 'es', '/project');
    expect(summary.filePath).toBe(author.filePath);
    expect(full.filePath).toBe(author.filePath);
  });

  test('el title de la variante completa es igual al title del autor', () => {
    const author = makeAuthorDoc();
    const { full, summary } = assembleAuthorExportVariants(author, [], 'es', '/project');
    expect(full.metadata.title).toBe(summary.metadata.title);
  });

  test('incluye tagline en el body', () => {
    const author = makeAuthorDoc();
    const { summary } = assembleAuthorExportVariants(author, [], 'es', '/project');
    expect(summary.body).toContain('Escritora y periodista');
  });

  test('incluye contacto (location, email) en el body', () => {
    const author = makeAuthorDoc();
    const { summary } = assembleAuthorExportVariants(author, [], 'es', '/project');
    expect(summary.body).toContain('Ciudad de México');
    expect(summary.body).toContain('ana@example.com');
  });

  test('incluye skills, training, interests y languages en el body', () => {
    const author = makeAuthorDoc();
    const { summary } = assembleAuthorExportVariants(author, [], 'es', '/project');
    expect(summary.body).toContain('Narrativa');
    expect(summary.body).toContain('Licenciatura en Comunicación');
    expect(summary.body).toContain('Literatura latinoamericana');
    expect(summary.body).toContain('Español (nativo)');
  });

  test('incluye la bio del autor en el body', () => {
    const author = makeAuthorDoc();
    const { summary } = assembleAuthorExportVariants(author, [], 'es', '/project');
    expect(summary.body).toContain('Ana López es escritora con más de diez años de experiencia.');
  });

  test('incluye obras del autor en la trayectoria (filtrado por nombre)', () => {
    const author = makeAuthorDoc();
    const work = makeFileDoc('Ana López', 'El jardín', '2023-06-01');
    const other = makeFileDoc('Otro Autor', 'Libro ajeno', '2022-01-01');
    const { summary } = assembleAuthorExportVariants(author, [work, other], 'es', '/project');
    expect(summary.body).toContain('El jardín');
    expect(summary.body).not.toContain('Libro ajeno');
  });

  test('variante summary incluye abstract pero no body de obra', () => {
    const author = makeAuthorDoc();
    const work = makeFileDoc('Ana López', 'La crónica', '2023-01-01', 'Body exclusivo de la obra.', 'Abstract de la crónica.');
    const { summary } = assembleAuthorExportVariants(author, [work], 'es', '/project');
    expect(summary.body).toContain('Abstract de la crónica.');
    expect(summary.body).not.toContain('Body exclusivo de la obra.');
  });

  test('variante full incluye body y keywords de la obra', () => {
    const author = makeAuthorDoc();
    const work = makeFileDoc('Ana López', 'La crónica', '2023-01-01', 'Body exclusivo de la obra.', 'Abstract de la crónica.');
    const { full } = assembleAuthorExportVariants(author, [work], 'es', '/project');
    expect(full.body).toContain('Body exclusivo de la obra.');
    expect(full.body).toContain('narrativa');
  });

  test('ordena obras por fecha descendente', () => {
    const author = makeAuthorDoc();
    const old = makeFileDoc('Ana López', 'Obra antigua', '2020-01-01');
    const recent = makeFileDoc('Ana López', 'Obra reciente', '2024-01-01');
    const { summary } = assembleAuthorExportVariants(author, [old, recent], 'es', '/project');
    expect(summary.body.indexOf('Obra reciente')).toBeLessThan(summary.body.indexOf('Obra antigua'));
  });

  test('body vacío si el autor no tiene obras', () => {
    const author = makeAuthorDoc();
    const { summary } = assembleAuthorExportVariants(author, [], 'es', '/project');
    expect(summary.body).not.toContain('## Trayectoria');
  });
});

// ---------------------------------------------------------------------------
// resolveItemsForExport / resolvePartsForExport — partes en colecciones
// ---------------------------------------------------------------------------

describe('parts en colecciones (exportación)', () => {
  function makeCollectionWithParts(partItems: Record<string, string[]>, looseItems: string[] = []): BuildDocument {
    return makeDoc({
      type: 'collection',
      filePath: '/project/libro.md',
      relativePath: 'libro.md',
      frontmatter: {
        title: 'Libro',
        date: '',
        author: [],
        speakers: [],
        type: 'collection',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: looseItems,
        parts: Object.entries(partItems).map(([name, items]) => ({ name, items })),
      },
      body: '',
    });
  }

  test('resolveItemsForExport aplana items de todas las partes', () => {
    const collection = makeCollectionWithParts({
      'Primera parte': ['cap1.md', 'cap2.md'],
      'Segunda parte': ['cap3.md'],
    });

    const pool = [
      makeDoc({ type: 'file', relativePath: 'cap1.md' }),
      makeDoc({ type: 'file', relativePath: 'cap2.md' }),
      makeDoc({ type: 'file', relativePath: 'cap3.md' }),
    ];

    const resolved = resolveItemsForExport(collection, pool);
    expect(resolved).toHaveLength(3);
    expect(resolved[0]?.relativePath).toBe('cap1.md');
    expect(resolved[2]?.relativePath).toBe('cap3.md');
  });

  test('resolveItemsForExport respeta el orden de las partes y sus items', () => {
    const collection = makeCollectionWithParts({
      Z: ['b.md', 'a.md'],
      A: ['d.md', 'c.md'],
    });

    const pool = [
      makeDoc({ type: 'file', relativePath: 'a.md' }),
      makeDoc({ type: 'file', relativePath: 'b.md' }),
      makeDoc({ type: 'file', relativePath: 'c.md' }),
      makeDoc({ type: 'file', relativePath: 'd.md' }),
    ];

    const resolved = resolveItemsForExport(collection, pool);
    expect(resolved[0]?.relativePath).toBe('b.md');
    expect(resolved[1]?.relativePath).toBe('a.md');
    expect(resolved[2]?.relativePath).toBe('d.md');
    expect(resolved[3]?.relativePath).toBe('c.md');
  });

  test('resolvePartsForExport retorna grupos con items resueltos', () => {
    const collection = makeCollectionWithParts({
      Teoría: ['cap1.md'],
      Práctica: ['cap2.md', 'cap3.md'],
    });

    const pool = [
      makeDoc({ type: 'file', relativePath: 'cap1.md', body: 'Teoría' }),
      makeDoc({ type: 'file', relativePath: 'cap2.md', body: 'Ejercicio 1' }),
      makeDoc({ type: 'file', relativePath: 'cap3.md', body: 'Ejercicio 2' }),
    ];

    const parts = resolvePartsForExport(collection, pool);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.name).toBe('Teoría');
    expect(parts[0]?.items).toHaveLength(1);
    expect(parts[0]?.items[0]?.body).toBe('Teoría');
    expect(parts[1]?.name).toBe('Práctica');
    expect(parts[1]?.items).toHaveLength(2);
    expect(parts[1]?.items[1]?.body).toBe('Ejercicio 2');
  });

  test('resolvePartsForExport retorna [] si el doc no tiene parts', () => {
    const doc = makeDoc({ type: 'collection', frontmatter: { ...makeDoc({ type: 'collection' }).frontmatter, items: [] } });
    expect(resolvePartsForExport(doc, [])).toHaveLength(0);
  });

  test('assembleBookBody emite \\part{Name} entre grupos', () => {
    const collection = makeCollectionWithParts({
      'Parte I': ['cap1.md'],
      'Parte II': ['cap2.md'],
    });

    const pool = [
      makeDoc({
        type: 'file',
        relativePath: 'cap1.md',
        frontmatter: { ...makeDoc({ type: 'file' }).frontmatter, title: 'Uno', items: [] },
        body: 'Contenido uno.',
      }),
      makeDoc({
        type: 'file',
        relativePath: 'cap2.md',
        frontmatter: { ...makeDoc({ type: 'file' }).frontmatter, title: 'Dos', items: [] },
        body: 'Contenido dos.',
      }),
    ];

    const parts = resolvePartsForExport(collection, pool);
    const items = resolveItemsForExport(collection, pool);
    const exportDoc = assembleExportDocument(collection, items, 'es', '/project', undefined, undefined, undefined, parts);
    expect(exportDoc).not.toBeNull();
    const body = exportDoc!.body;

    expect(body).toContain('\\part{Parte I}');
    expect(body).toContain('\\part{Parte II}');
    expect(body).toContain('# Uno');
    expect(body).toContain('# Dos');
    // \part debe aparecer ANTES del primer capítulo de cada grupo
    expect(body.indexOf('\\part{Parte I}')).toBeLessThan(body.indexOf('# Uno'));
    expect(body.indexOf('\\part{Parte II}')).toBeLessThan(body.indexOf('# Dos'));
  });

  test('assembleBookBody con parts omite \\newpage antes de \\part', () => {
    // Cuando se usan parts, \newpage está al final de cada item, no antes del \part
    const collection = makeCollectionWithParts({
      Única: ['cap1.md', 'cap2.md'],
    });

    const pool = [
      makeDoc({
        type: 'file',
        relativePath: 'cap1.md',
        frontmatter: { ...makeDoc({ type: 'file' }).frontmatter, title: 'Uno', items: [] },
        body: 'A',
      }),
      makeDoc({
        type: 'file',
        relativePath: 'cap2.md',
        frontmatter: { ...makeDoc({ type: 'file' }).frontmatter, title: 'Dos', items: [] },
        body: 'B',
      }),
    ];

    const parts = resolvePartsForExport(collection, pool);
    const items = resolveItemsForExport(collection, pool);
    const exportDoc = assembleExportDocument(collection, items, 'es', '/project', undefined, undefined, undefined, parts);
    const body = exportDoc!.body;

    // Debe haber \newpage entre items pero no antes de \part
    expect(body).toContain('\\part{Única}');
    // Nota: \newpage se emite después del body de cada item; no se espera que
    // aparezca antes de \part.
    const partIndex = body.indexOf('\\part{Única}');
    const firstNewpageAfterPart = body.indexOf('\\newpage', partIndex);
    expect(firstNewpageAfterPart).toBeGreaterThan(partIndex);
  });

  test('retrocompat: collection sin parts se comporta igual que antes', () => {
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
        items: ['a.md'],
      },
      body: '',
    });

    const item = makeDoc({
      type: 'file',
      filePath: '/project/a.md',
      relativePath: 'a.md',
      frontmatter: {
        title: 'A',
        date: '',
        author: ['Autor'],
        speakers: [],
        type: 'file',
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
      },
      body: 'Body.',
    });

    const exportDoc = assembleExportDocument(collection, [item], 'es', '/project');
    expect(exportDoc).not.toBeNull();
    expect(exportDoc!.body).toContain('# A');
    expect(exportDoc!.body).toContain('*Por Autor*');
    expect(exportDoc!.body).not.toContain('\\part{');
  });

  // ---------------------------------------------------------------------------
  // Mixed: items sueltos + partes
  // ---------------------------------------------------------------------------

  test('resolveItemsForExport concatena items sueltos + items de partes', () => {
    const collection = makeCollectionWithParts({ 'Parte I': ['cap1.md'] }, ['prologo.md']);

    const pool = [makeDoc({ type: 'file', relativePath: 'prologo.md' }), makeDoc({ type: 'file', relativePath: 'cap1.md' })];

    const resolved = resolveItemsForExport(collection, pool);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.relativePath).toBe('prologo.md');
    expect(resolved[1]?.relativePath).toBe('cap1.md');
  });

  test('assembleBookBody emite items sueltos antes de \\part', () => {
    const collection = makeCollectionWithParts({ 'Parte I': ['cap1.md'] }, ['prologo.md', 'introduccion.md']);

    const pool = [
      makeDoc({
        type: 'file',
        relativePath: 'prologo.md',
        frontmatter: { ...makeDoc({ type: 'file' }).frontmatter, title: 'Prólogo', items: [] },
        body: 'Prólogo.',
      }),
      makeDoc({
        type: 'file',
        relativePath: 'introduccion.md',
        frontmatter: { ...makeDoc({ type: 'file' }).frontmatter, title: 'Introducción', items: [] },
        body: 'Introducción.',
      }),
      makeDoc({
        type: 'file',
        relativePath: 'cap1.md',
        frontmatter: { ...makeDoc({ type: 'file' }).frontmatter, title: 'Fundamentos', items: [] },
        body: 'Contenido.',
      }),
    ];

    const parts = resolvePartsForExport(collection, pool);
    const items = resolveItemsForExport(collection, pool);
    const exportDoc = assembleExportDocument(collection, items, 'es', '/project', undefined, undefined, undefined, parts);
    const body = exportDoc!.body;

    // Orden: items sueltos → partes
    const prologoIdx = body.indexOf('# Prólogo');
    const introIdx = body.indexOf('# Introducción');
    const partIdx = body.indexOf('\\part{Parte I}');
    const capIdx = body.indexOf('# Fundamentos');

    expect(prologoIdx).toBeGreaterThan(-1);
    expect(introIdx).toBeGreaterThan(-1);
    expect(partIdx).toBeGreaterThan(-1);
    expect(capIdx).toBeGreaterThan(-1);

    // Items sueltos ANTES de \part
    expect(prologoIdx).toBeLessThan(partIdx);
    expect(introIdx).toBeLessThan(partIdx);
    // \part ANTES de su capítulo
    expect(partIdx).toBeLessThan(capIdx);
    // Items sueltos sin \part
    expect(body).not.toContain('\\part{Prólogo');
    expect(body).not.toContain('\\part{Introducción');
  });
});
