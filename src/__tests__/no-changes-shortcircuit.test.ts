import { describe, expect, it } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from '../builder/orchestrator.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { initTestProject, withTempDir } from './helpers.js';

const pandocOk = await getPandocVersion().catch(() => null);

/**
 * Reporter que sólo acumula lo que el reporter recibe, para poder assertar
 * sobre el camino que el build tomó.
 */
function recordingReporter() {
  const logs: string[] = [];
  const files: string[] = [];
  return {
    logs,
    files,
    setFormats(): void {},
    planPhases(): void {},
    startPhase(): void {},
    reportFile(f: { relativePath: string }): void {
      files.push(f.relativePath);
    },
    completePhase(): void {},
    log(m: string): void {
      logs.push(m);
    },
    addWarning(): void {},
    addSummaryLine(): void {},
    showCleanup(): void {},
    startLightFormats(): void {},
    finish(): Promise<void> {
      return Promise.resolve();
    },
    fail(): Promise<void> {
      return Promise.resolve();
    },
  };
}

describe.skipIf(!pandocOk)('atajo de "sin cambios" (#2496)', () => {
  it('el segundo build sin cambios corta antes de procesar y no limpia dist', async () => {
    await withTempDir(async (cwd) => {
      await initTestProject(cwd);

      // Primer build: genera la salida.
      await build(cwd, { full: true });
      expect(await Bun.file(join(cwd, 'dist', 'files', 'test-document.html')).exists()).toBe(true);

      // Segundo build sin tocar nada: debe cortar por el guard.
      const r = recordingReporter();
      await build(cwd, {}, r);

      expect(r.logs).toContain('Ningún documento modificado — sin cambios');
      // Cortar aquí significa que no se tocó ningún documento.
      expect(r.files).toEqual([]);
      // Y que la limpieza que vive ENTRE los dos guards tampoco corrió.
      expect(r.logs.some((l) => l.includes('archivo residual'))).toBe(false);
    });
  });

  it('con un proyecto sin documentos el build sale antes de los guards', async () => {
    await withTempDir(async (cwd) => {
      await mkdir(cwd, { recursive: true });
      await Bun.write(join(cwd, 'iteraciones.config.yaml'), ['language: es-MX', 'format:', '  html:', '    generate: true'].join('\n'));

      const r = recordingReporter();
      await build(cwd, {}, r);

      // El `return` de allDocs.length === 0 (orchestrator.ts:741) ocurre antes
      // de los guards: por eso ninguno de los dos puede dispararse aquí, y por
      // eso el segundo guard es inalcanzable en el caso de cero documentos.
      expect(r.logs).not.toContain('Ningún documento modificado — sin cambios');
      expect(r.files).toEqual([]);
    });
  });
});
