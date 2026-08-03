import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BuildMetadata, computeBuildMetadata, computeWorkSets } from '../builder/build-planner.js';
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-planner-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function doc(relativePath: string): BuildDocument {
  return { filePath: join('/proyecto', relativePath), relativePath, frontmatter: { title: relativePath, date: '', author: [] } };
}

function meta(overrides: Partial<BuildMetadata> = {}): BuildMetadata {
  return {
    currentFormats: ['latex'],
    newFormats: [],
    removedFormats: [],
    configHashes: {},
    transpilerHash: 'h',
    bibHash: 'b',
    formatInvalidated: { pdf: false, html: false, epub: false, markdown: false },
    transpilersInvalidated: false,
    bibInvalidated: false,
    pdfOn: false,
    latexOn: true,
    htmlOn: false,
    epubOn: false,
    mdOn: false,
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
    expect(work.renderDocs).toEqual([]);
    expect(work.exportSets.pdf).toEqual([]);
    expect(work.usedPhases).toEqual(['discovery']);
  });

  it('documentos modificados: entran en astChanged, renderDocs y los exportSets activos', () => {
    const work = computeWorkSets(meta(), DOCS, new Set(['a.md']));
    expect(work.anyWork).toBe(true);
    expect(work.renderDocs.map((d) => d.relativePath)).toEqual(['a.md']);
    expect(work.exportSets.pdf.map((d) => d.relativePath)).toEqual(['a.md']);
    expect(work.usedPhases).toEqual(['discovery', 'render', 'latex']);
  });

  it('transpilersInvalidated: todos los documentos se re-renderizan', () => {
    const work = computeWorkSets(meta({ transpilersInvalidated: true }), DOCS, new Set());
    expect(work.astChanged.size).toBe(3);
    expect(work.renderDocs.length).toBe(3);
  });

  it('formatInvalidated.html con htmlOn: todos los docs van al exportSet html sin re-render', () => {
    const work = computeWorkSets(
      meta({ htmlOn: true, formatInvalidated: { pdf: false, html: true, epub: false, markdown: false } }),
      DOCS,
      new Set(),
    );
    expect(work.exportSets.html.length).toBe(3);
    expect(work.renderDocs.length).toBe(0);
    expect(work.usedPhases).toEqual(['discovery', 'html']);
  });

  it('nuevo formato pdf con latex: astExportCandidates para regenerar solo el tex body', () => {
    // Al activar un formato nuevo, su hash de config cambia → formatInvalidated true
    const work = computeWorkSets(
      meta({ newFormats: ['pdf'], pdfOn: true, latexOn: true, formatInvalidated: { pdf: true, html: false, epub: false, markdown: false } }),
      DOCS,
      new Set(),
    );
    expect(work.newPdf).toBe(true);
    expect(work.astExportCandidates.length).toBe(3);
    // Los astExportCandidates se procesan en la fase render (renderFromAstCache)
    expect(work.usedPhases).toEqual(['discovery', 'render', 'latex', 'pdf']);
  });

  it('todos los formatos activos: usedPhases incluye render, latex, pdf, html, epub y markdown', () => {
    const m = meta({
      pdfOn: true,
      latexOn: true,
      htmlOn: true,
      epubOn: true,
      mdOn: true,
      formatInvalidated: { pdf: true, html: true, epub: true, markdown: true },
    });
    const work = computeWorkSets(m, DOCS, new Set(['b.md']));
    expect(work.usedPhases).toEqual(['discovery', 'render', 'latex', 'pdf', 'html', 'epub', 'markdown']);
    expect(work.exportSets.html.length).toBe(3);
    expect(work.exportSets.markdown.length).toBe(3);
  });
});

describe('computeBuildMetadata', () => {
  it('calcula hashes y flags de formato desde la configuración', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'format:\n  latex: true\n  html:\n    generate: true\n', 'utf8');
      const siteConfig = await loadSiteConfig(dir);
      const plan = await computeBuildMetadata(dir, siteConfig, null);
      expect(plan.currentFormats).toEqual(['latex', 'html']);
      expect(plan.latexOn).toBe(true);
      expect(plan.htmlOn).toBe(true);
      expect(plan.generateLatex).toBe(true);
      expect(plan.needsCss).toBe(true);
      expect(plan.newFormats).toEqual([]);
      expect(plan.removedFormats).toEqual([]);
      expect(plan.formatInvalidated).toEqual({ pdf: false, html: false, epub: false, markdown: false });
    });
  });

  it('sin prevState: nada se considera invalidado', async () => {
    await withTempDir(async (dir) => {
      const siteConfig = await loadSiteConfig(dir);
      const plan = await computeBuildMetadata(dir, siteConfig, null);
      expect(plan.transpilersInvalidated).toBe(false);
      expect(plan.bibInvalidated).toBe(false);
      expect(plan.formatInvalidated.pdf).toBe(false);
    });
  });

  it('con prevState de otros formatos: newFormats y removedFormats se calculan', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'format:\n  latex: true\n  html:\n    generate: true\n', 'utf8');
      const siteConfig = await loadSiteConfig(dir);
      const prevState = {
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
