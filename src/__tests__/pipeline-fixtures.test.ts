import { describe, expect, it, spyOn } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as pandocRunner from '../lib/pandoc-runner.js';
import { initTestProject, withTempDir } from './helpers.js';

/**
 * Pipeline completo SIN procesos (#2031, PR 3): build() orquesta discovery →
 * pipeline → cierre con execPandoc/getPandocVersion espíados (fixtures de la
 * parte 1) y un BuildReporter falso contando eventos. Sin tracker, sin
 * latexmk, sin Tailwind (html desactivado ⇒ needsCss false).
 */

type ReporterCalls = { method: string; args: unknown[] }[];

function fakeReporter(calls: ReporterCalls) {
  return {
    setFormats: (formats: unknown[]) => {
      calls.push({ method: 'setFormats', args: [formats] });
    },
    planPhases: (phases: string[]) => {
      calls.push({ method: 'planPhases', args: [phases] });
      return Promise.resolve();
    },
    startPhase: (phase: string, total?: number) => {
      calls.push({ method: 'startPhase', args: [phase, total] });
    },
    reportFile: (file: unknown) => {
      calls.push({ method: 'reportFile', args: [file] });
    },
    completePhase: (count?: number) => {
      calls.push({ method: 'completePhase', args: [count] });
    },
    log: (message: string) => {
      calls.push({ method: 'log', args: [message] });
    },
    addWarning: (message: string) => {
      calls.push({ method: 'warn', args: [message] });
    },
    addSummaryLine: (line: string) => {
      calls.push({ method: 'summary', args: [line] });
    },
    showCleanup: () => {
      calls.push({ method: 'cleanup', args: [] });
    },
    startLightFormats: () => {
      calls.push({ method: 'light', args: [] });
    },
    finish: (processed: number, cached: number) => {
      calls.push({ method: 'finish', args: [processed, cached] });
      return Promise.resolve();
    },
    fail: () => {
      calls.push({ method: 'fail', args: [] });
      return Promise.resolve();
    },
  };
}

describe('pipeline sin procesos sobre fixtures (#2031 PR3)', () => {
  it('build() con reporter falso y pandoc espíado orquesta el ciclo completo sin binario', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      // Solo formatos que pasan por execPandoc espiable; html OFF ⇒ sin Tailwind
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        [
          'language: es-MX',
          'format:',
          '  html:',
          '    generate: false',
          '  latex:',
          '    generate: true',
          '  epub:',
          '    generate: true',
          '  markdown:',
          '    generate: true',
        ].join('\n'),
        'utf8',
      );

      const fixtureLatex = '\\subsection{Sección}\\label{sección}\n\nTexto.\n';
      const fixtureMd = '---\ntitle: "Test Document"\nlanguage: es-MX\n---\n\nTexto.\n';

      let versionCalls = 0;
      const pandocCalls: { to?: string; outputPath?: string }[] = [];
      const spyVersion = spyOn(pandocRunner, 'getPandocVersion').mockImplementation(async () => {
        versionCalls += 1;
        return 'pandoc 3.10.2';
      });
      const spyExec = spyOn(pandocRunner, 'execPandoc').mockImplementation(async (options) => {
        pandocCalls.push({ to: options.to, outputPath: options.outputPath });
        return options.to === 'latex' ? fixtureLatex : fixtureMd;
      });

      const calls: ReporterCalls = [];
      try {
        process.exitCode = 0;
        const { build } = await import('../builder/orchestrator.js');
        await build(dir, {}, fakeReporter(calls));
        expect(process.exitCode).toBe(0);

        // ── Contrato del reporter (secuencia y conteos) ──
        const methods = calls.map((c) => c.method);
        expect(methods).toContain('setFormats');
        expect(methods.filter((m) => m === 'startPhase').length).toBeGreaterThanOrEqual(2); // discovery + render
        expect(methods).toContain('planPhases');
        expect(methods).toContain('finish');
        expect(methods).not.toContain('fail');

        const finish = calls.find((c) => c.method === 'finish');
        expect(finish?.args[0]).toBe(1); // processed
        expect(finish?.args[1]).toBe(0); // cached

        // Fase render declarada con el total de documentos
        const renderStart = calls.find((c) => c.method === 'startPhase' && c.args[0] === 'render');
        expect(renderStart?.args[1]).toBe(1);

        // ── pandoc espíado: una invocación por formato ligero activo ──
        expect(versionCalls).toBe(1); // una sola consulta de versión por build
        const tos = pandocCalls.map((c) => c.to).sort();
        expect(tos).toEqual(['epub3', 'latex', 'markdown']);
        const epub = pandocCalls.find((c) => c.to === 'epub3');
        expect(epub?.outputPath).toContain('test-document.epub');

        // ── Salidas reales en dist: .tex y .md escritos por nuestro código a
        // partir de los fixtures; el EPUB NO existe (la invocación fue espía)
        const files = (await readdir(join(dir, 'dist', 'files'), { recursive: true }))
          .map((f) => String(f))
          .filter((f) => f.startsWith('test-document'));
        expect(files).toContain('test-document.tex');
        expect(files).toContain('test-document.md');
        expect(files).not.toContain('test-document.epub');

        // El estado quedó válido (escritura única del cierre, #2025)
        const state = JSON.parse(await Bun.file(join(dir, '.iteraciones', 'state.json')).text());
        expect(state.completed).toBe(true);
      } finally {
        spyVersion.mockRestore();
        spyExec.mockRestore();
      }
    });
  }, 30_000);
});
