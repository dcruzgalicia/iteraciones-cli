import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPdfxOutputValidation } from '../builder/pdfx-check.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { withTempDir } from './helpers.js';

/** Valor original para restaurar el directorio gestionado del binario en tests. */
const originalXdgCacheHome = process.env.XDG_CACHE_HOME;

function spyStderr() {
  return spyOn(process.stderr, 'write');
}

/** Isola la caché del binario en el directorio temporal del test (hermético). */
function useIsolatedManagedBin(dir: string): void {
  process.env.XDG_CACHE_HOME = join(dir, 'cache');
}

/** Escribe un binario falso que emite un informe JSON fijo (evita compilar Rust). */
async function writeFakeBinary(dir: string, json: string): Promise<void> {
  const binDir = join(dir, 'cache', 'iteraciones', 'bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, 'iteraciones-pdfcheck'), `#!/bin/sh\ncat <<'EOF'\n${json}\nEOF\n`, 'utf8');
  await chmod(join(binDir, 'iteraciones-pdfcheck'), 0o755);
}

/** Config un proyecto con 99-pdfx activo (97 y 98 desactivados). */
async function initPdfxProject(dir: string): Promise<void> {
  await writeFile(
    join(dir, 'iteraciones.config.yaml'),
    'lang: es-MX\nformat:\n  pdf:\n    generate: true\n    disabled-preamble-filters:\n      - 97-eso-pic\n      - 98-crop\n',
    'utf8',
  );
}

describe('runPdfxOutputValidation (fase final del build)', () => {
  afterEach(() => {
    process.exitCode = 0;
    process.env.XDG_CACHE_HOME = originalXdgCacheHome;
  });

  it('omite la validación cuando 99-pdfx está desactivado en la config', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'lang: es-MX\nformat:\n  pdf:\n    generate: true\n    disabled-preamble-filters:\n      - 97-eso-pic\n      - 98-crop\n      - 99-pdfx\n',
        'utf8',
      );
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      const config = await loadSiteConfig(dir);
      const stderrSpy = spyStderr();
      let output = '';
      try {
        const result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(result).toEqual({ validated: 0, failed: 0, summaryLine: undefined });
      } finally {
        stderrSpy.mockRestore();
      }
      expect(output).toBe('');
    });
  });

  it('omite la validación cuando no hay PDFs en la salida', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      const config = await loadSiteConfig(dir);
      const result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
      expect(result).toEqual({ validated: 0, failed: 0, summaryLine: undefined });
    });
  });

  it('sin binario ni build, advierte y no rompe (validación omitida)', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      const config = await loadSiteConfig(dir);
      const stderrSpy = spyStderr();
      let output = '';
      try {
        const result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(result).toEqual({ validated: 0, failed: 0, summaryLine: undefined });
      } finally {
        stderrSpy.mockRestore();
      }
      expect(output).toContain('no se validaron');
    });
  });

  it('muestra el fallo por PDF cuando el binario reporta errores de certificación', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFakeBinary(
        dir,
        '{"valid": false, "level": "PDF/X-1a:2003", "errors": [{"code":"MissingTrimBox","message":"falta TrimBox","page":0,"object_id":null,"clause":"6.1.1"}], "warnings": []}',
      );
      const config = await loadSiteConfig(dir);
      const stderrSpy = spyStderr();
      let output = '';
      try {
        const result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(result).toEqual({ validated: 1, failed: 1, summaryLine: undefined });
      } finally {
        stderrSpy.mockRestore();
      }
      expect(output).toContain('doc.pdf');
      expect(output).toContain('MissingTrimBox');
      expect(output).toContain('(1 fallo, primero');
      expect(output).toContain('página 1');
      expect(output).toContain('1 de 1 PDFs no certifican PDF/X-1a.');
    });
  });

  it('sin fallos de certificación confirma el éxito en la línea de resumen (issue #1960)', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFakeBinary(dir, '{"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}');
      const config = await loadSiteConfig(dir);
      const stderrSpy = spyStderr();
      let output = '';
      try {
        const result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(result.validated).toBe(1);
        expect(result.failed).toBe(0);
        expect(result.summaryLine).toContain('Validación PDF/X-1a: 1 PDF certifica PDF/X-1a');
      } finally {
        stderrSpy.mockRestore();
      }
      expect(output).toBe('');
    });
  });
});
