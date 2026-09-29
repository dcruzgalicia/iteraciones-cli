import { describe, expect, it } from 'bun:test';
import { COLLECTION_FRAGMENT_MAX_WORDS, extractFragment } from '../builder/collection-fragment.js';
import {
  type CollectionEntry,
  collectionBaseContent,
  collectionCardsContent,
  collectionScanContent,
  memberHtmlHrefs,
} from '../builder/pipeline-formats.js';
import type { DiscoveryEntry } from '../builder/types.js';

/**
 * #2483 — la página HTML de una collection deja de fusionar sus files[]:
 * cada miembro es una tarjeta con su autor y título, su fragmento (primer
 * párrafo o fenced div completo, a lo más 100 palabras, con `...` si hubo
 * corte) y un enlace a su HTML completo. El EPUB sigue completo.
 */

function words(count: number, prefix = 'palabra'): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`).join(' ');
}

function entry(overrides: Partial<CollectionEntry> = {}): CollectionEntry {
  return {
    file: 'doc.md',
    title: 'Documento',
    creator: ['Autora A'],
    subtitle: undefined,
    type: 'file',
    lineLength: undefined,
    pages: undefined,
    body: 'Contenido de doc.',
    ...overrides,
  };
}

describe('fragmento de collection para su tarjeta (#2483)', () => {
  it('devuelve el primer párrafo tal cual', () => {
    expect(extractFragment('Una frase corta.\n\nY otra que no entra.')).toBe('Una frase corta.');
  });

  it('salta los blancos y los encabezados iniciales', () => {
    expect(extractFragment('# Título\n\n## Subtítulo\n\nEl párrafo de verdad.')).toBe('El párrafo de verdad.');
  });

  it('salta un encabezado setext', () => {
    expect(extractFragment('Título del documento\n=====================\n\nTras el título.')).toBe('Tras el título.');
  });

  it(`recorta el párrafo a ${COLLECTION_FRAGMENT_MAX_WORDS} palabras y añade ...`, () => {
    const fragment = extractFragment(`Un primer párrafo. ${words(150)}`);
    expect(fragment.endsWith('...')).toBe(true);
    expect(fragment.split(/\s+/)).toHaveLength(COLLECTION_FRAGMENT_MAX_WORDS + 1);
  });

  it('el corte no parte un enlace', () => {
    const fragment = extractFragment(`${words(99)} [texto del enlace](./destino.html)`);
    expect(fragment).not.toContain('[');
    expect(fragment.endsWith('...')).toBe(true);
    // retrocede hasta el token anterior al `[`: 99 palabras + la marca de corte
    expect(fragment.split(/\s+/)).toHaveLength(COLLECTION_FRAGMENT_MAX_WORDS);
  });

  it('devuelve un fenced div completo, con sus líneas de fence', () => {
    const body = '::: {.nota}\nContenido corto de la nota.\n:::\n\nDespués del div.';
    expect(extractFragment(body)).toBe('::: {.nota}\nContenido corto de la nota.\n:::');
  });

  it('recorta por dentro el fenced div y ahí añade el ...', () => {
    const fragment = extractFragment(`::: {.nota}\n${words(150)}\n:::`);
    const lines = fragment.split('\n');
    expect(lines[0]).toBe('::: {.nota}');
    expect(lines[lines.length - 1]).toBe(':::');
    expect(lines[lines.length - 2]).toBe('...');
    expect((lines[1] ?? '').split(/\s+/)).toHaveLength(COLLECTION_FRAGMENT_MAX_WORDS);
  });

  it('cierra él mismo un fenced div que no cierra', () => {
    expect(extractFragment('::: {.nota}\nContenido sin cierre.')).toBe('::: {.nota}\nContenido sin cierre.\n:::');
  });

  it('salta un bloque de código inicial y toma el párrafo siguiente', () => {
    expect(extractFragment('```js\ncodigo();\n```\n\nTras el código.')).toBe('Tras el código.');
  });

  it('no usa como fragmento un cuerpo que solo tiene código', () => {
    expect(extractFragment('```text\nsolo código\n```')).toBe('');
  });

  it('salta listas y citas iniciales', () => {
    expect(extractFragment('- uno\n- dos\n\nTras la lista.')).toBe('Tras la lista.');
    expect(extractFragment('> una cita\n\nTras la cita.')).toBe('Tras la cita.');
  });

  it('devuelve vacío sin texto que mostrar', () => {
    expect(extractFragment('')).toBe('');
    expect(extractFragment('   \n\n# Solo un título\n')).toBe('');
  });
});

describe('tarjetas de la página HTML de una collection (#2483)', () => {
  const hrefs = new Map([['doc.md', './documento-por-autora-a.html']]);

  it('una tarjeta por miembro: autor, título, fragmento y enlace', () => {
    const html = collectionCardsContent([entry()], hrefs, 'cuerpo de la collection');
    expect(html).toContain(':::: {class="');
    expect(html).toContain('tarjeta-fragmento');
    expect(html).toContain('<h2>Autora A</h2>');
    expect(html).toContain('<h3>Documento</h3>');
    expect(html).toContain('Contenido de doc.');
    expect(html).toContain('[Leer el texto completo →](./documento-por-autora-a.html)');
  });

  it('cada tarjeta va en el contenedor del masonry, no dentro de otra', () => {
    const html = collectionCardsContent([entry()], hrefs, '');
    expect(html.startsWith('<div class="break-inside-avoid pb-6">\n\n:::: {class=')).toBe(true);
    expect(html.endsWith('::::\n\n</div>')).toBe(true);
    expect(html.match(/break-inside-avoid pb-6/g) ?? [], 'un contenedor por tarjeta').toHaveLength(1);
  });

  it('no fusiona el cuerpo completo del miembro', () => {
    const body = `${words(150)}.\n\nSegundo párrafo que no debe aparecer.`;
    const html = collectionCardsContent([entry({ body })], hrefs, '');
    expect(html).not.toContain('Segundo párrafo que no debe aparecer.');
    expect(html.split('tarjeta-fragmento')).toHaveLength(2); // una sola tarjeta
  });

  it('miembro sin slug se queda sin enlace', () => {
    const html = collectionCardsContent([entry()], new Map(), '');
    expect(html).not.toContain('Leer el texto completo');
    expect(html).toContain('Contenido de doc.');
  });

  it('sin miembros devuelve el contenido de la collection', () => {
    expect(collectionCardsContent([], new Map(), 'cuerpo propio')).toBe('cuerpo propio');
  });

  it('la tarjeta de la collection lleva sus datos y su body propio (#2483)', () => {
    const fm = {
      title: 'Antología',
      subtitle: 'Siete piezas',
      collectionCreator: ['Editora Principal'],
      creator: ['Autora A', 'Autora B'],
      date: '2024-05-01',
    };
    const html = collectionCardsContent([entry()], hrefs, '---\ntitle: Antología\n---\n\nIntro de la antología.\n', fm);
    expect(html.startsWith('<div class="break-inside-avoid pb-6">'), 'la ficha va en el nivel del masonry').toBe(true);
    expect(html).toContain('tarjeta-coleccion');
    expect(html).toContain('>Colección</h2>');
    expect(html).toContain('Autora A, Autora B');
    expect(html).toContain('Editora Principal');
    expect(html).toContain('<h1 class="mb-3 font-bold uppercase tracking-wide text-3xl text-accent-500">Antología</h1>');
    expect(html).toContain('Siete piezas');
    expect(html).toContain('1 de mayo de 2024');
    expect(html, 'el body propio sale dentro de la tarjeta').toContain('Intro de la antología.');
    expect(html, 'el frontmatter no viaja dentro de la tarjeta').not.toContain('---');
    // una tarjeta de datos más una por miembro, cada una en su contenedor
    expect(html.match(/break-inside-avoid pb-6/g) ?? []).toHaveLength(2);
  });

  it('la tarjeta de la collection sin body propio ni subtítulo ni fecha', () => {
    const html = collectionCardsContent([entry()], hrefs, '', { title: 'Antología', creator: ['Autora A'] });
    expect(html).toContain('Antología');
    expect(html).toContain('<p class="mb-4 text-sm font-mono');
    expect(html, 'sin intro, la ficha no deja margen').toContain('<div class="mb-0">');
    expect(html).not.toContain('mb-24');
  });

  it('el EPUB sigue recibiendo la fusión completa', () => {
    const body = `${words(150)}.\n\nSegundo párrafo que sí debe aparecer.`;
    const epub = collectionBaseContent([entry({ body })], 'html', '');
    expect(epub).toContain('Segundo párrafo que sí debe aparecer.');
    expect(epub).not.toContain('tarjeta-fragmento');
  });
});

describe('escaneo de imágenes de una collection (#2483)', () => {
  const source = ['---', 'title: Antología', '---', '', '![portada](img/portada.png)', ''].join('\n');

  it('incluye el body propio: sale en la tarjeta de la página HTML', () => {
    const scanned = collectionScanContent([entry()], source);
    expect(scanned).toContain('![portada](img/portada.png)');
    expect(scanned, 'y también las secciones de los miembros').toContain('Contenido de doc.');
  });

  it('sin body propio solo quedan las secciones', () => {
    const scanned = collectionScanContent([entry()], '---\ntitle: Antología\n---\n');
    expect(scanned).toContain('Contenido de doc.');
    expect(scanned).not.toContain('\n\n\n');
  });

  it('un documento que no es collection se devuelve tal cual', () => {
    expect(collectionScanContent([], source)).toBe(source);
  });
});

describe('enlaces al HTML de cada miembro (#2483)', () => {
  const slugIndex = new Map<string, DiscoveryEntry>([
    ['doc.md', { title: 'Documento', creator: [], slug: 'documento-por-autora-a' }],
    ['anexos/doc.md', { title: 'Documento', creator: [], slug: 'documento-por-autora-a' }],
    ['sin-slug.md', { title: 'Otro', creator: [] }],
  ]);

  it('relativo desde la raíz', () => {
    const hrefs = memberHtmlHrefs('coleccion.md', [entry({ file: 'doc.md' })], slugIndex);
    expect(hrefs.get('doc.md')).toBe('./documento-por-autora-a.html');
  });

  it('relativo desde un subdirectorio', () => {
    const hrefs = memberHtmlHrefs('anexos/coleccion.md', [entry({ file: 'anexos/doc.md' })], slugIndex);
    expect(hrefs.get('anexos/doc.md')).toBe('./../anexos/documento-por-autora-a.html');
  });

  it('un miembro sin slug no tiene enlace', () => {
    const hrefs = memberHtmlHrefs('coleccion.md', [entry({ file: 'sin-slug.md' })], slugIndex);
    expect(hrefs.has('sin-slug.md')).toBe(false);
  });
});
