import { describe, expect, it } from 'bun:test';
import { COLLECTION_FRAGMENT_MAX_WORDS, extractFragment } from '../builder/collection-fragment.js';
import { type CollectionEntry, collectionBaseContent, collectionCardsContent, memberHtmlHrefs } from '../builder/pipeline-formats.js';
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
    expect(html.endsWith('::::')).toBe(true);
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

  it('el EPUB sigue recibiendo la fusión completa', () => {
    const body = `${words(150)}.\n\nSegundo párrafo que sí debe aparecer.`;
    const epub = collectionBaseContent([entry({ body })], 'html', '');
    expect(epub).toContain('Segundo párrafo que sí debe aparecer.');
    expect(epub).not.toContain('tarjeta-fragmento');
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
