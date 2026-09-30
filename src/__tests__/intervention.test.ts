import { describe, expect, it, spyOn } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type CollectionEntry, collectionBaseContent, collectionCardsContent } from '../builder/pipeline-formats.js';
import { loadPreambleFilters } from '../builder/preamble-loader.js';
import { validateFrontmatterFields } from '../builder/project-validator.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

function validate(fm: Record<string, unknown>) {
  return validateFrontmatterFields(fm);
}

function errors(fm: Record<string, unknown>) {
  return validate(fm).filter((i) => i.severity === 'error');
}

describe('intervention type validation', () => {
  it('accepts type: intervention with no extra fields', () => {
    const errs = errors({ type: 'intervention' });
    expect(errs).toHaveLength(0);
  });

  it('accepts pages as positive integer', () => {
    const errs = errors({ type: 'intervention', pages: 3 });
    expect(errs).toHaveLength(0);
  });

  it('accepts lineLength as decimal between 0 and 1', () => {
    const errs = errors({ type: 'intervention', lineLength: 0.6 });
    expect(errs).toHaveLength(0);
  });

  it('rejects pages as string', () => {
    const errs = errors({ type: 'intervention', pages: 'two' });
    expect(errs.length).toBe(1);
    expect(errs[0]?.message).toContain('pages');
  });

  it('rejects pages as zero', () => {
    const errs = errors({ type: 'intervention', pages: 0 });
    expect(errs.length).toBe(1);
    expect(errs[0]?.message).toContain('pages');
  });

  it('rejects pages as negative', () => {
    const errs = errors({ type: 'intervention', pages: -1 });
    expect(errs.length).toBe(1);
  });

  it('rejects lineLength as float', () => {
    const errs = errors({ type: 'intervention', lineLength: 1.5 });
    expect(errs.length).toBe(1);
    expect(errs[0]?.message).toContain('lineLength');
  });

  it('does not require title or creator', () => {
    const errs = errors({ type: 'intervention', date: '2026-01-01' });
    expect(errs).toHaveLength(0);
  });
});

describe('intervention type in other contexts', () => {
  it('validates as unknown type when not intervention', () => {
    const errs = errors({ type: 'invalid' });
    expect(errs.length).toBe(1);
    expect(errs[0]?.message).toContain('intervention');
  });

  it('accepts pages and lineLength together', () => {
    const errs = errors({ type: 'intervention', pages: 2, lineLength: 0.5 });
    expect(errs).toHaveLength(0);
  });
});

describe('intervention preamble loading', () => {
  it('loads intervention preamble filters', async () => {
    const filters = await loadPreambleFilters(undefined, undefined, 'intervention');
    expect(filters.length).toBeGreaterThan(0);
    const names = filters.map((f) => f.name);
    expect(names).toContain('19-maketitle');
    expect(names).toContain('28-titlepages');
  });

  it('intervention preamble has same filter count as file preamble', async () => {
    const fileFilters = await loadPreambleFilters(undefined, undefined, 'file');
    const interventionFilters = await loadPreambleFilters(undefined, undefined, 'intervention');
    expect(interventionFilters.length).toBe(fileFilters.length);
  });
});

/**
 * #2485 — una intervention es un recurso de imprenta (regla con nombre y título,
 * más sus páginas en blanco): el PDF y el markdown exportado la conservan, pero
 * ni la página HTML ni el EPUB la llevan.
 */
describe('una intervention dentro de files[]', () => {
  const documento: CollectionEntry = {
    file: 'doc.md',
    creator: ['Autora A'],
    title: 'Documento',
    subtitle: undefined,
    type: 'file',
    lineLength: undefined,
    pages: undefined,
    body: 'Contenido de doc.',
  };
  const intervencion: CollectionEntry = { ...documento, file: 'inter.md', type: 'intervention', body: 'regla de imprenta' };
  const hrefs = new Map([
    ['doc.md', './documento-por-autora-a.html'],
    ['inter.md', './regla-de-imprenta.html'],
  ]);

  it('no sale en la página HTML, ni como tarjeta ni como enlace', () => {
    const html = collectionCardsContent([documento, intervencion], hrefs, '');
    expect(html).toContain('Contenido de doc.');
    expect(html).not.toContain('regla de imprenta');
    expect(html, 'su HTML propio no existe, así que tampoco puede enlazarse').not.toContain('./regla-de-imprenta.html');
  });

  it('no sale en el EPUB', () => {
    const epub = collectionBaseContent([documento, intervencion], 'html', '');
    expect(epub).toContain('Contenido de doc.');
    expect(epub).not.toContain('regla de imprenta');
  });

  it('se queda en el PDF, que la compone con su regla, y en el markdown exportado', () => {
    const latex = collectionBaseContent([documento, intervencion], 'latex', '');
    expect(latex).toContain('regla de imprenta');
    expect(latex, 'con su sección de imprenta').toContain('\\rule{');
    const markdown = collectionBaseContent([documento, intervencion], 'markdown', '');
    expect(markdown).toContain('regla de imprenta');
  });

  it('una collection de solo interventions no se puede construir', () => {
    // la comprobación vive en el build: aquí se comprueba que no queda nada
    expect(collectionCardsContent([intervencion], hrefs, '---\ntitle: Antología\n---\n\nIntro.\n')).toContain('Intro.');
  });
});

const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('intervention.test.ts', SKIP_REASONS.pandoc);

describe.skipIf(!pandocOk)('una collection con una intervention (#2485)', () => {
  const config = ['language: es-MX', 'format:', '  html:', '    generate: true', '  epub:', '    generate: true'].join('\n');

  it('la intervention no sale ni en la página HTML ni en el EPUB', async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, 'iteraciones.config.yaml'), `${config}\n`);
      await Bun.write(
        join(dir, 'coleccion.md'),
        ['---', 'title: Antología', 'type: collection', 'files:', '  - doc.md', '  - regla.md', '---', '', 'Intro.', ''].join('\n'),
      );
      await Bun.write(join(dir, 'doc.md'), ['---', 'title: Documento', 'creator:', '  - Autora A', '---', '', 'Contenido de doc.', ''].join('\n'));
      await Bun.write(
        join(dir, 'regla.md'),
        ['---', 'title: Regla', 'type: intervention', 'pages: 1', '---', '', 'regla de imprenta', ''].join('\n'),
      );

      process.exitCode = 0;
      const { runBuild } = await import('../cli/dispatcher.js');
      await runBuild(dir);
      expect(process.exitCode, 'el build no falla').toBe(0);

      const html = await Bun.file(join(dir, 'dist', 'files', 'antologia.html')).text();
      expect(html, 'una sola tarjeta de miembro').toContain('Contenido de doc.');
      expect(html, 'la intervention no sale como tarjeta').not.toContain('regla de imprenta');
      expect(await Bun.file(join(dir, 'dist', 'files', 'regla.html')).exists(), 'la intervention no tiene página propia').toBe(false);

      const epub = await Bun.file(join(dir, 'dist', 'files', 'antologia.epub')).exists();
      expect(epub, 'el EPUB se sigue generando, sin la intervention').toBe(true);
      process.exitCode = 0;
    });
  }, 180_000);

  it('si todos los files[] son interventions, el build falla y avisa', async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, 'iteraciones.config.yaml'), `${config}\n`);
      await Bun.write(
        join(dir, 'coleccion.md'),
        ['---', 'title: Antología', 'type: collection', 'files:', '  - regla.md', '---', '', 'Intro.', ''].join('\n'),
      );
      await Bun.write(join(dir, 'regla.md'), ['---', 'title: Regla', 'type: intervention', '---', '', 'regla de imprenta', ''].join('\n'));

      const stderrSpy = spyOn(process.stderr, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        const { runBuild } = await import('../cli/dispatcher.js');
        await runBuild(dir);
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(process.exitCode, 'el build falla').toBe(1);
      expect(output).toContain('todos los archivos de files[] son "type: intervention"');
      expect(output).toContain('al menos un archivo de otro tipo');
      expect(existsSync(join(dir, 'dist', 'files', 'antologia.html')), 'y no se publica la página').toBe(false);
      process.exitCode = 0;
    });
  }, 180_000);
});
