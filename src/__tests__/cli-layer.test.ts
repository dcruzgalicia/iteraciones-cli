import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBuild } from '../cli/dispatcher.js';
import { checkLatexEngine } from '../cli/doctor/system-checks.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { initTestProject, registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

// Los tests que invocan pandoc real se marcan como skip si no está instalado
// (mismo patrón que integration.test.ts): sin pandoc la suite pasa con skips.
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('cli-layer.test.ts', SKIP_REASONS.pandoc);
// unzip se usa para inspeccionar EPUBs generados: skip real si no está en PATH.
const _unzipOk = (await Bun.which('unzip')) !== null;

// La suite aserta strings exactos de la salida: la colorización ANSI se fuerza
// off aunque el stream sea un TTY (los asserts no dependen del entorno).
// NO_COLOR es el mecanismo estándar; el logger lo lee directo.
beforeAll(() => {
  process.env.NO_COLOR = '1';
});

// El smoke de PDF real solo corre si el motor LaTeX está disponible.
const _latexOk = (await checkLatexEngine()).ok;

/**
 * Restaura exitCode y el spy de stderr después de cada test que los toque.
 */
function resetExitCode() {
  process.exitCode = 0;
}

function _spyStderr() {
  const s = spyOn(process.stderr, 'write');
  return s;
}

describe.skipIf(!pandocOk)('runBuild', () => {
  afterEach(resetExitCode);

  it('un estado sin completed se ignora y el siguiente build reprocesa (interrupción simulada)', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      await runBuild(dir);
      expect(process.exitCode).toBe(0);

      // Simular un build interrumpido a mitad de render: el estado persistido
      // por discover no tiene completed (el marcado final nunca ocurrió) y el
      // documento cambió después de discovery.
      await writeFile(join(dir, 'test.md'), '---\ntitle: Contenido nuevo\ndate: 2026-01-02\n---\n\nContenido nuevo.\n', 'utf8');
      const statePath = join(dir, '.iteraciones', 'state.json');
      const raw = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
      delete raw.completed;
      await Bun.write(statePath, JSON.stringify(raw));

      // El build debe reprocesar todo (el estado no es caché válida) y dejar
      // el estado marcado como completo para el siguiente build.
      const stdoutSpy = spyOn(process.stdout, 'write');
      let output = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
        stdoutSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(output).toContain('Documentos');
      expect(output).not.toContain('Sin cambios (reutilizado)');
      const finalState = JSON.parse(await Bun.file(statePath).text()) as { completed?: boolean };
      expect(finalState.completed).toBe(true);

      // Un build posterior sin cambios reutiliza la caché (camino normal).
      const cachedSpy = spyOn(process.stdout, 'write');
      let cachedOutput = '';
      try {
        process.exitCode = 0;
        await runBuild(dir);
      } finally {
        cachedOutput = cachedSpy.mock.calls.map((c) => String(c[0])).join('');
        cachedSpy.mockRestore();
      }
      expect(process.exitCode).toBe(0);
      expect(cachedOutput).toContain('(reutilizado)');
    });
  });
});
