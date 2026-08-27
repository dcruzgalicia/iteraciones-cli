import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type BuildMetadata, computeBuildMetadata, computeWorkSets } from '../builder/build-planner.js';
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { type ActiveFormats, type FormatKey, toActiveFormats } from '../config/site-config.js';
import { withTempDir } from './helpers.js';

function doc(relativePath: string): BuildDocument {
  return { filePath: join('/proyecto', relativePath), relativePath, frontmatter: { title: relativePath, date: '', creator: [] } };
}

/** Convierte una lista de formatos activos al mapa canónico (mismo helper que el pipeline). */
function active(formats: FormatKey[]): ActiveFormats {
  return toActiveFormats(formats);
}

function meta(overrides: Partial<BuildMetadata> = {}): BuildMetadata {
  return {
    currentFormats: ['latex'],
    newFormats: [],
    removedFormats: [],
    configHashes: {},
    configFileCache: {},
    filtersHash: 'h',
    filterFileCache: {},
    bibHash: 'b',
    bibFileCache: {},
    formatInvalidated: { latex: false, html: false, epub: false, markdown: false },
    filtersInvalidated: false,
    bibInvalidated: false,
    bibFiles: [],
    bibOptions: undefined,
    activeFormats: active(['latex']),
    generateLatex: true,
    needsCss: false,
    ...overrides,
  };
}

const DOCS = [doc('a.md'), doc('b.md'), doc('c.md')];

describe('computeWorkSets', () => {
  it('sin cambios ni invalidaciones: anyWork false y conjuntos vacíos', () => {
    const work = computeWorkSets(meta(), DOCS, new Set());
    expect(work.anyWork).toBe(false);
    expect(work.docsChanged.size).toBe(0);
    expect(work.exportSets.latex).toEqual([]);
  });

  it('documentos modificados: entran en docsChanged y los exportSets activos', () => {
    const work = computeWorkSets(meta(), DOCS, new Set(['a.md']));
    expect(work.anyWork).toBe(true);
    expect(work.docsChanged).toEqual(new Set(['a.md']));
    expect(work.exportSets.latex.map((d) => d.relativePath)).toEqual(['a.md']);
  });

  it('filtersInvalidated: todos los documentos se re-renderizan', () => {
    const work = computeWorkSets(meta({ filtersInvalidated: true }), DOCS, new Set());
    expect(work.docsChanged.size).toBe(3);
  });

  it('bibInvalidated: todos los docs van a los exportSets sin re-render (las citas se resuelven en export)', () => {
    const work = computeWorkSets(
      meta({
        bibInvalidated: true,
        activeFormats: active(['pdf', 'latex', 'html', 'epub', 'markdown']),
      }),
      DOCS,
      new Set(),
    );
    expect(work.anyWork).toBe(true);
    expect(work.docsChanged.size).toBe(0);
    expect(work.exportSets.latex.length).toBe(3);
    expect(work.exportSets.html.length).toBe(3);
    expect(work.exportSets.epub.length).toBe(3);
    expect(work.exportSets.markdown.length).toBe(3);
  });

  it('bibInvalidated sin formatos activos: anyWork false', () => {
    const work = computeWorkSets(meta({ bibInvalidated: true, activeFormats: active([]) }), DOCS, new Set());
    expect(work.anyWork).toBe(false);
  });

  it('formatInvalidated.html con htmlOn: todos los docs van al exportSet html sin re-render', () => {
    const work = computeWorkSets(
      meta({ activeFormats: active(['html']), formatInvalidated: { latex: false, html: true, epub: false, markdown: false } }),
      DOCS,
      new Set(),
    );
    expect(work.exportSets.html.length).toBe(3);
    expect(work.docsChanged.size).toBe(0);
  });

  it('nuevo formato pdf/latex: formatInvalidated incluye todos los docs en el exportSet latex', () => {
    // Al activar un formato nuevo, su hash de config cambia → formatInvalidated true
    const work = computeWorkSets(
      meta({
        newFormats: ['pdf'],
        activeFormats: active(['pdf', 'latex']),
        formatInvalidated: { latex: true, html: false, epub: false, markdown: false },
      }),
      DOCS,
      new Set(),
    );
    expect(work.exportSets.latex.length).toBe(3);
    expect(work.docsChanged.size).toBe(0);
  });

  it('todos los formatos activos: todos los docs van a los exportSets correspondientes', () => {
    const m = meta({
      activeFormats: active(['pdf', 'latex', 'html', 'epub', 'markdown']),
      formatInvalidated: { latex: true, html: true, epub: true, markdown: true },
    });
    const work = computeWorkSets(m, DOCS, new Set(['b.md']));
    expect(work.exportSets.html.length).toBe(3);
    expect(work.exportSets.markdown.length).toBe(3);
  });
});

describe('computeBuildMetadata', () => {
  it('calcula hashes y flags de formato desde la configuración', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'format:\n  latex:\n    generate: true\n  html:\n    generate: true\n', 'utf8');
      const siteConfig = await loadSiteConfig(dir);
      const plan = await computeBuildMetadata(dir, siteConfig, null);
      expect(plan.currentFormats).toEqual(['latex', 'html']);
      expect(plan.activeFormats).toEqual(active(['latex', 'html']));
      expect(plan.generateLatex).toBe(true);
      expect(plan.needsCss).toBe(true);
      expect(plan.newFormats).toEqual([]);
      expect(plan.removedFormats).toEqual([]);
      expect(plan.formatInvalidated).toEqual({ latex: false, html: false, epub: false, markdown: false });
    });
  });

  it('sin prevState: nada se considera invalidado', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), '', 'utf8');
      const siteConfig = await loadSiteConfig(dir);
      const plan = await computeBuildMetadata(dir, siteConfig, null);
      expect(plan.filtersInvalidated).toBe(false);
      expect(plan.bibInvalidated).toBe(false);
      expect(plan.formatInvalidated.latex).toBe(false);
    });
  });

  it('con prevState de otros formatos: newFormats y removedFormats se calculan', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'format:\n  latex:\n    generate: true\n  html:\n    generate: true\n', 'utf8');
      const siteConfig = await loadSiteConfig(dir);
      const prevState = {
        schemaVersion: 2,
        startedAt: 0,
        activeFormats: ['latex', 'pdf'],
        entries: new Map(),
      };
      const plan = await computeBuildMetadata(dir, siteConfig, prevState);
      expect(plan.newFormats).toEqual(['html']);
      expect(plan.removedFormats).toEqual(['pdf']);
    });
  });
});
