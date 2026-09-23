import { describe, expect, it, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertToEpub, convertToMarkdown } from '../builder/export/runner.js';
import type { ExportDocument } from '../builder/export/types.js';
import type { LuaFilterGroup } from '../builder/filter-resolver.js';
import * as pandocRunner from '../lib/pandoc-runner.js';
import { withTempDir } from './helpers.js';

/**
 * Exporters sobre spies de execPandoc (#2031, PR 2): se verifica el
 * contrato de argumentos y la escritura de salida SIN invocar el binario.
 * Los smokes reales de EPUB/Markdown quedan en export-runner.test.ts.
 */

const NO_FILTERS: LuaFilterGroup = {
  semantic: [],
  latex: [],
  html: [],
  flags: [],
  user: [],
  resolvedNames: new Set(),
};

const BODY = '---\ntitle: "Mi título"\n---\n\nHola.\n';

const EXPORT_DOC: ExportDocument = {
  filePath: '/proyecto/doc.md',
  relativePath: 'doc.md',
  metadata: {
    title: 'Mi título',
    creator: ['Autora Uno'],
    date: '8 de agosto de 2026',
    dateIso: '2026-08-08',
    language: 'es-MX',
    toc: false,
  },
};

describe('exporters sobre spies de execPandoc (#2031 PR2)', () => {
  function spyPandoc(stdoutFixture = '') {
    const calls: Parameters<typeof pandocRunner.execPandoc>[0][] = [];
    const spy = spyOn(pandocRunner, 'execPandoc').mockImplementation(async (options) => {
      calls.push(options);
      return stdoutFixture;
    });
    return { calls, restore: () => spy.mockRestore() };
  }

  it('convertToEpub: epub3 con metadatos DC y --toc condicional', async () => {
    await withTempDir(async (dir) => {
      const { calls, restore } = spyPandoc();
      try {
        const out = join(dir, 'libro.epub');
        await convertToEpub(BODY, out, EXPORT_DOC, NO_FILTERS, undefined, { toc: true, language: 'en' });
        const call = calls[0];
        if (call === undefined) throw new Error('execPandoc no fue invocado');
        expect(call.to).toBe('epub3');
        expect(call.outputPath).toBe(out);
        expect(call.from).toBe('markdown+auto_identifiers+mark'); // MD_READER
        expect(call.extraArgs).toContain('--toc');
        expect(call.extraArgs).toContain('--metadata=language:en'); // fm manda (#2010)
        expect(call.extraArgs).toContain('--metadata=title:Mi título');
        expect(call.extraArgs).toContain('--metadata=creator:Autora Uno');
        expect(call.extraArgs).toContain('--metadata=date:2026-08-08');
      } finally {
        restore();
      }
    });
  });

  it('convertToEpub sin toc omite --toc; citeproc solo con bibliografía', async () => {
    await withTempDir(async (dir) => {
      const { calls, restore } = spyPandoc();
      try {
        const out = join(dir, 'b.epub');
        await convertToEpub(BODY, out, EXPORT_DOC, NO_FILTERS);
        let call = calls[0];
        if (call === undefined) throw new Error('sin llamada 1');
        expect(call.extraArgs).not.toContain('--toc');
        expect(call.extraArgs).not.toContain('--citeproc');

        const conBib: ExportDocument = {
          ...EXPORT_DOC,
          metadata: { ...EXPORT_DOC.metadata, bibliography: '/abs/refs.bib' },
        };
        await convertToEpub(BODY, out, conBib, NO_FILTERS);
        call = calls[1];
        if (call === undefined) throw new Error('sin llamada 2');
        expect(call.extraArgs).toContain('--citeproc');
      } finally {
        restore();
      }
    });
  });

  it('convertToMarkdown no invoca pandoc: escribe frontmatter + body directo (#2436)', async () => {
    await withTempDir(async (dir) => {
      const { calls, restore } = spyPandoc('');
      try {
        const out = join(dir, 'salida.md');
        const doc: ExportDocument = {
          ...EXPORT_DOC,
          metadata: { ...EXPORT_DOC.metadata, toc: true, tocDepth: 2, bibliography: join(dir, 'refs.bib'), csl: join(dir, 'estilos.csl') },
        };
        await convertToMarkdown(BODY, out, doc, {});
        const text = readFileSync(out, 'utf8');
        // Sin roundtrip por pandoc: el body no se transforma (#2436)
        expect(calls).toHaveLength(0);
        expect(text).toContain('title: Mi título');
        expect(text).toContain('language: es-MX');
        expect(text.endsWith('\n\nHola.\n')).toBe(true);
        // bibliography/csl no viajan en el markdown exportado (los aporta la config del sitio al re-procesar)
        expect(text).not.toContain('bibliography:');
        expect(text).not.toContain('csl:');
        expect(text).not.toContain(dir);
      } finally {
        restore();
      }
    });
  });
});
