import { describe, expect, it } from 'bun:test';
import {
  buildFormatsItems,
  extractReferencesBlock,
  type FormatsLink,
  loadReferencesCardTemplate,
  removeTocReferencesLink,
} from '../builder/html-composer.js';

/** Wrapper representativo de la tarjeta (la estructura real vive en el recurso). */
const CARD_TEMPLATE = '<div class="wrap"><h2 id="refs-heading" class="chip">Referencias</h2>{{refs-list}}</div>';

describe('extractReferencesBlock', () => {
  const MARKER = '<!-- block:referencias -->';

  it('extrae el bloque con divs csl-entry anidados (cierre balanceado)', () => {
    const html = [
      '<article>',
      '<p>Texto.</p>',
      '<h1 id="refs-heading">Referencias</h1>',
      '<div id="refs" class="references">',
      '<div class="csl-entry">',
      '<div class="csl-left-margin">(1)</div>',
      '<div class="csl-right-inline">Entrada.</div>',
      '</div>',
      '</div>',
      '</article>',
    ].join('');
    const result = extractReferencesBlock(html, CARD_TEMPLATE);
    // El bloque extraído incluye el div anidado completo (el primer </div> no cierra)
    expect(result.block).toContain('id="refs-heading"');
    expect(result.block).toContain('csl-right-inline');
    expect(result.block).toContain('</div>');
    expect(result.html).not.toContain('refs-heading');
    expect(result.html).not.toContain('<div id="refs"');
    expect(result.html).toContain('<p>Texto.</p>');
  });

  it('sin cierre balanceado (depth !== 0) no extrae y devuelve el HTML intacto', () => {
    const html = '<h1 id="refs-heading">Referencias</h1><div id="refs"><div class="csl-entry"><div>sin cerrar</div>';
    const result = extractReferencesBlock(html, CARD_TEMPLATE);
    expect(result.block).toBeUndefined();
    expect(result.html).toBe(html);
  });

  it('con el marcador pero sin div#refs elimina solo el heading sintético y el marcador', () => {
    const html = `<article><h1 id="refs-heading">Referencias</h1></article>${MARKER}`;
    const result = extractReferencesBlock(html, CARD_TEMPLATE);
    expect(result.block).toBeUndefined();
    expect(result.html).not.toContain('refs-heading');
    expect(result.html).not.toContain(MARKER);
    expect(result.html).toContain('<article></article>');
  });

  it('sin referencias ni marcador no toca el HTML', () => {
    const html = '<article><p>Texto.</p></article>';
    const result = extractReferencesBlock(html, CARD_TEMPLATE);
    expect(result.block).toBeUndefined();
    expect(result.html).toBe(html);
  });

  it('un heading Referencias propio del documento (id referencias) nunca se toca', () => {
    const html = '<article><h1 id="referencias">Referencias</h1><p>Manual.</p></article>';
    const result = extractReferencesBlock(html, CARD_TEMPLATE);
    expect(result.block).toBeUndefined();
    expect(result.html).toBe(html);
  });

  it('el recurso real compone la tarjeta con el chip del heading (sin clases en TS)', async () => {
    const cardTemplate = await loadReferencesCardTemplate();
    const html = [
      '<article>',
      '<p>Texto.</p>',
      '        <h1 id="refs-heading">Referencias</h1>',
      '        <div id="refs" class="references">',
      '        <div class="csl-entry">Entrada.</div>',
      '        </div>',
      '</article>',
    ].join('\n');
    const result = extractReferencesBlock(html, cardTemplate);
    expect(result.block).toBeDefined();
    // El wrapper y el chip viven en el recurso; el TS solo sustituye la lista
    expect(result.block).toContain('class="break-inside-avoid pb-6"');
    expect(result.block).toContain('[&_.csl-entry]:mb-3');
    expect(result.block).toContain('id="refs-heading"');
    expect(result.block).toContain('class="inline-block align-top rounded-full');
    expect(result.block).toContain('<div id="refs" class="references">');
    expect(result.block).toContain('csl-entry');
    expect(result.block).not.toContain('{{refs-list}}');
    // El marcador queda sustituido en el HTML final
    expect(result.html).not.toContain('<div id="refs"');
    // El heading del article se retira: lo sustituye el del recurso
    expect(result.html).not.toContain('id="refs-heading"');
  });
});

describe('removeTocReferencesLink', () => {
  it('elimina el ítem del TOC que enlaza a #refs-heading', () => {
    const html = '<nav><ul><li><a href="#seccion">Sección</a></li><li><a href="#refs-heading">Referencias</a></li></ul></nav>';
    const result = removeTocReferencesLink(html);
    expect(result).not.toContain('#refs-heading');
    expect(result).toContain('<a href="#seccion">Sección</a>');
    expect(result).toContain('<li>'); // el ítem de la sección se conserva
  });

  it('sin ítem de referencias no modifica el HTML', () => {
    const html = '<nav><ul><li><a href="#seccion">Sección</a></li></ul></nav>';
    expect(removeTocReferencesLink(html)).toBe(html);
  });
});

describe('buildFormatsItems', () => {
  const formats: FormatsLink[] = [
    { href: './doc.pdf', key: 'pdf', name: 'PDF', description: 'Documento final' },
    { href: './doc.epub', key: 'epub', name: 'EPUB', description: 'Edición adaptable' },
  ];

  it('sin formatos retorna undefined', () => {
    expect(buildFormatsItems([])).toBeUndefined();
  });

  it('con un formato genera el enlace con su nombre', () => {
    const block = buildFormatsItems([formats[0] ?? { href: '', key: 'pdf', name: '', description: '' }]);
    expect(block).toContain('href="./doc.pdf"');
    expect(block).toContain('>PDF</span>');
    expect(block).toContain('Documento final');
  });

  it('con varios formatos los incluye todos', () => {
    const block = buildFormatsItems(formats);
    expect(block).toContain('href="./doc.pdf"');
    expect(block).toContain('href="./doc.epub"');
    expect(block).toContain('>PDF</span>');
    expect(block).toContain('>EPUB</span>');
  });

  it('los items no incluyen el wrapper de la tarjeta (vive en el recurso)', async () => {
    const block = buildFormatsItems(formats);
    expect(block).not.toContain('break-inside-avoid');
    expect(block).not.toContain('<section');
    // El recurso card-formatos.html aporta el wrapper y la variable $formats$
    const cardResource = await Bun.file('src/lib/resources/html/card-formatos.html').text();
    expect(cardResource).toContain('break-inside-avoid');
    expect(cardResource).toContain('$formats$');
  });
});
