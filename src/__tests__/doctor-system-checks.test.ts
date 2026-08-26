import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as systemChecks from '../cli/doctor/system-checks.js';
import { withTempDir } from './helpers.js';

const { validateProject } = await import('../cli/validate.js');
const { initTestProject } = await import('./helpers.js');

describe('validateProject (separación de entorno y validez)', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it('validate nunca consulta el motor LaTeX, ni con pdf.generate: true (el entorno es trabajo de doctor)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      await writeFile(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\nformat:\n  pdf:\n    generate: true\n', 'utf8');
      const spy = spyOn(systemChecks, 'checkLatexEngine').mockImplementation(async () => ({
        label: 'pdflatex disponible',
        ok: false,
        detail: 'pdflatex no encontrado en PATH (spy de prueba)',
      }));
      try {
        process.exitCode = 0;
        await validateProject(dir);
      } finally {
        spy.mockRestore();
      }
      expect(spy).toHaveBeenCalledTimes(0);
      expect(process.exitCode).toBe(0);
    });
  });
});
