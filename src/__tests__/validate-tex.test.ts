import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as systemChecks from '../cli/doctor/system-checks.js';

const { runValidate } = await import('../cli/validate.js');
const { initTestProject } = await import('./helpers.js');

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-cli-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('runValidate (criterio del motor LaTeX)', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it('un proyecto html-only no consulta el motor LaTeX (exit 0 sin TeX)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      const spy = spyOn(systemChecks, 'checkLatexEngine').mockImplementation(async () => ({
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex no encontrado en PATH (spy de prueba)',
      }));
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        spy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(spy).toHaveBeenCalledTimes(0);
    });
  });

  it('con pdf.generate: true exige el motor LaTeX y falla sin él', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\nformat:\n  pdf:\n    generate: true\n', 'utf8');
      const spy = spyOn(systemChecks, 'checkLatexEngine').mockImplementation(async () => ({
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex no encontrado en PATH (spy de prueba)',
      }));
      let calls = 0;
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        calls = spy.mock.calls.length;
        spy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
      expect(calls).toBe(1);
    });
  });

  it('con format.latex: true exige el motor LaTeX y falla sin él', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\nformat:\n  latex: true\n', 'utf8');
      const spy = spyOn(systemChecks, 'checkLatexEngine').mockImplementation(async () => ({
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex no encontrado en PATH (spy de prueba)',
      }));
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        spy.mockRestore();
      }
      expect(process.exitCode).toBe(1);
    });
  });

  it('pdf configurado pero con generate: false no exige el motor LaTeX', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'lang: es-MX\nformat:\n  pdf:\n    generate: false\n    show-date: true\n', 'utf8');
      const spy = spyOn(systemChecks, 'checkLatexEngine').mockImplementation(async () => ({
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex no encontrado en PATH (spy de prueba)',
      }));
      try {
        process.exitCode = 0;
        await runValidate(dir);
      } finally {
        spy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(spy).toHaveBeenCalledTimes(0);
    });
  });
});
