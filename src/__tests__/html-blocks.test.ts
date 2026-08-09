import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { assembleHtmlBlocks, blockMarker, resolveBlockOrder } from '../builder/html-blocks.js';

describe('resolveBlockOrder', () => {
  it('sin overrides usa el orden por defecto', () => {
    expect(resolveBlockOrder()).toEqual(['header', 'trayectura', 'formatos', 'indice', 'referencias', 'footer']);
  });

  it('un override individual mueve solo esa tarjeta', () => {
    // formatos: 4 lo mueve después de índice (3)
    expect(resolveBlockOrder({ formatos: 4 })).toEqual(['header', 'trayectura', 'indice', 'formatos', 'referencias', 'footer']);
  });

  it('desempata números iguales por el orden canónico de claves', () => {
    // formatos: 4 empata con referencias: 4 → formatos antes (canónico)
    expect(resolveBlockOrder({ formatos: 4 })).toEqual(['header', 'trayectura', 'indice', 'formatos', 'referencias', 'footer']);
    // header: 5 empata con footer: 99? no — prueba con header al final
    expect(resolveBlockOrder({ header: 100 })).toEqual(['trayectura', 'formatos', 'indice', 'referencias', 'footer', 'header']);
  });
});

describe('assembleHtmlBlocks', () => {
  const templateHtml = (): string =>
    [
      '<html><main class="m">',
      `  ${blockMarker('header')}`,
      '  <div class="c"><h2>Header</h2></div>',
      `  ${blockMarker('trayectura')}`,
      '  <div class="c"><article>Contenido</article></div>',
      `  ${blockMarker('indice')}`,
      '  <div class="c"><nav>Índice</nav></div>',
      `  ${blockMarker('footer')}`,
      '  <div class="c"><h2>Footer</h2></div>',
      '</main></html>',
    ].join('\n');

  it('ordena los bloques del template según el orden por defecto', () => {
    const out = assembleHtmlBlocks(templateHtml(), {});
    expect(out.indexOf('Header')).toBeLessThan(out.indexOf('Contenido'));
    expect(out.indexOf('Contenido')).toBeLessThan(out.indexOf('Índice'));
    expect(out.indexOf('Índice')).toBeLessThan(out.indexOf('Footer'));
  });

  it('combina bloques generados (formatos/referencias) y aplica overrides', () => {
    const generated = {
      formatos: `${blockMarker('formatos')}\n<div class="c"><h2>Formatos</h2></div>`,
      referencias: `${blockMarker('referencias')}\n<div class="c"><h2>Referencias</h2></div>`,
    };
    const out = assembleHtmlBlocks(templateHtml(), generated, { formatos: 4 });
    const pos = (s: string): number => out.indexOf(s);
    expect(pos('Header')).toBeLessThan(pos('Contenido'));
    expect(pos('Contenido')).toBeLessThan(pos('Índice'));
    expect(pos('Índice')).toBeLessThan(pos('Formatos'));
    expect(pos('Formatos')).toBeLessThan(pos('Referencias'));
    expect(pos('Referencias')).toBeLessThan(pos('Footer'));
  });

  it('omite bloques ausentes sin alterar el orden del resto', () => {
    // Sin el bloque indice (toc: false) y sin generados
    const html = templateHtml().replace(`  ${blockMarker('indice')}\n  <div class="c"><nav>Índice</nav></div>\n`, '');
    const out = assembleHtmlBlocks(html, {});
    expect(out).not.toContain('Índice');
    expect(out.indexOf('Contenido')).toBeLessThan(out.indexOf('Footer'));
    expect(out.indexOf('Header')).toBeLessThan(out.indexOf('Contenido'));
  });

  it('lanza BuildError si falta la estructura main (template roto)', () => {
    const html = templateHtml().replace('<main', '<div');
    expect(() => assembleHtmlBlocks(html, {})).toThrow('no contiene la estructura <main> esperada');
  });

  it('el template embarcado contiene los marcadores de bloque del template (integridad)', async () => {
    const templatePath = join(import.meta.dir, '../../src/lib/resources/template.html');
    const template = await Bun.file(templatePath).text();
    // Los bloques que viven en el template: header, trayectura, indice y footer.
    // formatos y referencias se generan en TS (render.ts) y no deben existir aquí.
    for (const key of ['header', 'trayectura', 'indice', 'footer']) {
      expect(template).toContain(blockMarker(key));
    }
    expect(template).not.toContain(blockMarker('formatos'));
    expect(template).not.toContain(blockMarker('referencias'));
  });
});
