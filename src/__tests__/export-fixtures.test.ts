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

  it('convertToMarkdown: standalone, rutas RELATIVAS de bib/csl y escritura del stdout', async () => {
    await withTempDir(async (dir) => {
      const stdoutFixture = '---\ntitle: "Mi título"\nlanguage: es-MX\n---\n\nHola.\n';
      const { calls, restore } = spyPandoc(stdoutFixture);
      try {
        const out = join(dir, 'salida.md');
        const doc: ExportDocument = {
          ...EXPORT_DOC,
          metadata: {
            ...EXPORT_DOC.metadata,
            toc: true,
            tocDepth: 2,
            bibliography: join(dir, 'refs.bib'),
            csl: join(dir, 'estilos.csl'),
          },
        };
        // Archivos reales: el CSL debe existir para viajar en la metadata
        const { writeFile } = await import('node:fs/promises');
        await writeFile(join(dir, 'refs.bib'), '@book{a, title={T}}\n', 'utf8');
        await writeFile(join(dir, 'estilos.csl'), '<style/>\n', 'utf8');
        await convertToMarkdown(BODY, out, doc, NO_FILTERS, dir);

        const call = calls[0];
        if (call === undefined) throw new Error('execPandoc no fue invocado');
        expect(call.to).toBe('markdown');
        const args = call.extraArgs ?? [];
        expect(args).toContain('--standalone');
        expect(args).toContain('--metadata=toc:true');
        expect(args).toContain('--metadata=toc-depth:2');
        // Portable: relativas al proyecto aunque la fuente sea absoluta (#1882)
        expect(args).toContain('--metadata=bibliography:refs.bib');
        expect(args).toContain('--metadata=csl:estilos.csl');
        // El stdout del writer se escribe tal cual en outputPath
        expect(readFileSync(out, 'utf8')).toBe(stdoutFixture);
      } finally {
        restore();
      }
    });
  });

  it('convertToMarkdown: CSL inexistente advierte y omite la metadata', async () => {
    await withTempDir(async (dir) => {
      const stderrSpy = spyOn(process.stderr, 'write');
      let output = '';
      const { calls, restore } = spyPandoc('');
      try {
        const out = join(dir, 's.md');
        const doc: ExportDocument = {
          ...EXPORT_DOC,
          metadata: { ...EXPORT_DOC.metadata, bibliography: '/p/refs.bib', csl: '/p/no-existe.csl' },
        };
        await convertToMarkdown(BODY, out, doc, NO_FILTERS, '/p');
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        const args = calls[0]?.extraArgs ?? [];
        expect(output).toContain('archivo CSL no encontrado');
        expect(args.some((a) => a.startsWith('--metadata=csl:'))).toBe(false);
        expect(args).toContain('--metadata=bibliography:refs.bib');
      } finally {
        stderrSpy.mockRestore();
        restore();
      }
    });
  });
});
