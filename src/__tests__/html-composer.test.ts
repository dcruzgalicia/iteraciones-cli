import { describe, expect, it, spyOn } from 'bun:test';
import { buildFormatsArgs, buildFormatsFlag, composeHtmlTemplate, type FormatsLink } from '../builder/html-composer.js';
import { extractReferencesBlock, loadReferencesCardTemplate, removeTocReferencesLink } from '../builder/html-postprocess.js';
import * as logger from '../lib/logger.js';

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

  it('HTML mal balanceado: avisa y devuelve el html intacto (#2080)', () => {
    const warnSpy = spyOn(logger, 'logWarning');
    // Un div interior sin cerrar deja depth≠0 al agotarse los cierres
    const html = '<article><h1 id="refs-heading">Refs</h1><div id="refs"><div class="filtro"><p>roto</p></div>';
    try {
      const result = extractReferencesBlock(html, CARD_TEMPLATE);
      expect(result.block).toBeUndefined();
      expect(result.html).toBe(html); // salida no corrupta: sin tocar
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('HTML mal balanceado'), 'html');
    } finally {
      warnSpy.mockRestore();
    }
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

describe('formatos por argv (#2445: un valor corto por formato, nunca HTML)', () => {
  const formats: FormatsLink[] = [
    { href: './doc.pdf', key: 'pdf', name: 'PDF', description: 'Documento final' },
    { href: './doc.epub', key: 'epub', name: 'EPUB', description: 'Edición adaptable' },
  ];

  it('sin formatos no hay flag', () => {
    expect(buildFormatsFlag([])).toBeUndefined();
    expect(buildFormatsArgs([])).toEqual([]);
  });

  it('con formatos el flag es un valor corto', () => {
    expect(buildFormatsFlag(formats)).toBe('1');
  });

  it('cada formato aporta exactamente un href corto', () => {
    expect(buildFormatsArgs(formats)).toEqual(['--variable=fmt-pdf:./doc.pdf', '--variable=fmt-epub:./doc.epub']);
  });

  it('ningún valor de argv lleva HTML ni saltos de línea', () => {
    for (const arg of buildFormatsArgs(formats)) {
      expect(arg).not.toContain('<');
      expect(arg).not.toContain('\n');
    }
  });

  it('el markup de formatos vive en la plantilla, con un $if$ por formato', async () => {
    const template = await composeHtmlTemplate({ format: undefined } as never);
    expect(template).toContain('$if(fmt-pdf)$');
    expect(template).toContain('$if(fmt-epub)$');
    expect(template).toContain('$if(formats)$');
    // iconos y textos horneados en el recurso, no en el argv
    expect(template).toContain('>PDF</span>');
    expect(template).toContain('>EPUB</span>');
    expect(template).not.toContain('$formats$');
  });

  it('el logo se hornea en la plantilla (#2445)', async () => {
    const siteConfig = { format: undefined } as never;
    const sinLogo = await composeHtmlTemplate(siteConfig);
    expect(sinLogo).not.toContain('$logo-block$');
    expect(sinLogo).not.toContain('logo-fill');

    const conLogo = await composeHtmlTemplate(siteConfig, '<svg id="el-logo"></svg>');
    expect(conLogo).toContain('logo-fill');
    expect(conLogo).toContain('<svg id="el-logo"></svg>');
    expect(conLogo).not.toContain('$logo-block$');
  });
});
