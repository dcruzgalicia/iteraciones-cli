import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPdfxOutputValidation } from '../builder/pdfx-check.js';
import { loadSiteConfig } from '../config/config-loader.js';
import * as runLib from '../lib/run.js';
import { ProcessSpawnError } from '../lib/run.js';
import { withTempDir } from './helpers.js';

/** Valor original (posiblemente ausente) para restaurar la caché del binario. */
const originalXdgCacheHome = process.env.XDG_CACHE_HOME;

/**
 * #2467 — restaura `XDG_CACHE_HOME` tal como estaba. Asignarle `undefined` no
 * borra la variable: la deja con el literal `"undefined"`, `managedBinDir()`
 * devuelve entonces una ruta RELATIVA y todo lo que gestione el binario acaba
 * dentro de la raíz del repositorio (`undefined/iteraciones/bin/…`). Mismo
 * patrón que el `finally` de `build-selection.test.ts`.
 */
function restoreXdgCacheHome(saved: string | undefined): void {
  if (saved === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = saved;
}

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

/** Binario falso certifica todo lo que no se llame «roto» (rutas por nombre). */
async function writeSelectiveBinary(dir: string): Promise<void> {
  const binDir = join(dir, 'cache', 'iteraciones', 'bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(
    join(binDir, 'iteraciones-pdfcheck'),
    [
      '#!/bin/sh',
      'case "$1" in',
      "  *roto*) cat <<'EOF'",
      '{"valid": false, "level": "PDF/X-1a:2001", "errors": [{"code":"MissingTrimBox","message":"falta TrimBox","page":0,"object_id":null,"clause":"6.1.1"}], "warnings": []}',
      'EOF',
      '    ;;',
      "  *) cat <<'EOF'",
      '{"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}',
      'EOF',
      '    ;;',
      'esac',
    ].join('\n'),
    'utf8',
  );
  await chmod(join(binDir, 'iteraciones-pdfcheck'), 0o755);
}

/** Config un proyecto con 99-pdfx activo (97 y 98 desactivados). */
async function initPdfxProject(dir: string): Promise<void> {
  await writeFile(
    join(dir, 'iteraciones.config.yaml'),
    'language: es-MX\nformat:\n  pdf:\n    generate: true\n    disabledPreambleFilters:\n      - 97-eso-pic\n      - 98-crop\n',
    'utf8',
  );
}

describe('runPdfxOutputValidation (fase final del build)', () => {
  afterEach(() => {
    process.exitCode = 0;
    restoreXdgCacheHome(originalXdgCacheHome);
  });

  it('omite la validación cuando 99-pdfx está desactivado en la config', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\nformat:\n  pdf:\n    generate: true\n    disabledPreambleFilters:\n      - 97-eso-pic\n      - 98-crop\n      - 99-pdfx\n',
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

  it('un PDF que no certifica lanza BuildError con archivo/página/código (decisión D2)', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFakeBinary(
        dir,
        '{"valid": false, "level": "PDF/X-1a:2001", "errors": [{"code":"MissingTrimBox","message":"falta TrimBox","page":0,"object_id":null,"clause":"6.1.1"},{"code":"FontNotEmbedded","message":"fuente no incrustada","page":2,"object_id":null,"clause":"6.2"}], "warnings": [{"code":"ProducerNotSet","message":"sin Producer","page":null,"object_id":null,"clause":null}]}',
      );
      const config = await loadSiteConfig(dir);
      let mensaje = '';
      try {
        await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
        expect.unreachable();
      } catch (err) {
        mensaje = err instanceof Error ? err.message : String(err);
      }
      // El fallo bloquea el build (99-pdfx activo = señal de imprenta) y el
      // mensaje muestra TODOS los fallos y warnings por PDF (issue #1971):
      // la ruta de fallo del build no imprime los warnings acumulados.
      expect(mensaje).toContain('1 de 1 PDFs no certifican PDF/X-1a.');
      expect(mensaje).toContain('doc.pdf');
      expect(mensaje).toContain('MissingTrimBox');
      expect(mensaje).toContain('FontNotEmbedded');
      expect(mensaje).toContain('(2 fallos)');
      expect(mensaje).toContain('página 1');
      expect(mensaje).toContain('página 3');
      expect(mensaje).toContain('ProducerNotSet');
      expect(mensaje).toContain('advertencia —');
    });
  });

  it('valida los PDFs anidados en subdirectorios de la salida', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files', 'capitulos'), { recursive: true });
      // Un PDF en la raíz y otro anidado: el pipeline escribe los PDFs según
      // la ruta del documento (pipeline.ts outBase), no solo en la raíz.
      await writeFile(join(dir, 'dist', 'files', 'index.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFile(join(dir, 'dist', 'files', 'capitulos', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFakeBinary(dir, '{"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}');
      const config = await loadSiteConfig(dir);
      const result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
      expect(result.validated).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.summaryLine).toContain('Validación PDF/X-1a: 2 PDFs certifican PDF/X-1a');
    });
  });

  it('un PDF anidado que no certifica lanza el error con su ruta relativa', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files', 'capitulos'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'capitulos', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFakeBinary(
        dir,
        '{"valid": false, "level": "PDF/X-1a:2001", "errors": [{"code":"MissingTrimBox","message":"falta TrimBox","page":0,"object_id":null,"clause":"6.1.1"}], "warnings": []}',
      );
      const config = await loadSiteConfig(dir);
      let mensaje = '';
      try {
        await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
        expect.unreachable();
      } catch (err) {
        mensaje = err instanceof Error ? err.message : String(err);
      }
      expect(mensaje).toContain('capitulos/doc.pdf');
      expect(mensaje).toContain('MissingTrimBox');
    });
  });

  describe('alcance del modo parcial (#2454)', () => {
    /** Dos PDFs en la salida: `bueno.pdf` certifica, `roto.pdf` no. */
    async function writeTwoPdfs(dir: string): Promise<string> {
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'bueno.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFile(join(dir, 'dist', 'files', 'roto.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeSelectiveBinary(dir);
      return join(dir, 'dist', 'files');
    }

    it('sin alcance sigue barriendo dist entero (cualquier build completo)', async () => {
      await withTempDir(async (dir) => {
        useIsolatedManagedBin(dir);
        await initPdfxProject(dir);
        const outDir = await writeTwoPdfs(dir);
        const config = await loadSiteConfig(dir);
        let mensaje = '';
        try {
          await runPdfxOutputValidation(outDir, config, { allowBuild: false });
          expect.unreachable();
        } catch (err) {
          mensaje = err instanceof Error ? err.message : String(err);
        }
        expect(mensaje).toContain('1 de 2 PDFs no certifican PDF/X-1a.');
        expect(mensaje).toContain('roto.pdf');
      });
    });

    it('con alcance solo valida los PDF que escribió esta corrida', async () => {
      await withTempDir(async (dir) => {
        useIsolatedManagedBin(dir);
        await initPdfxProject(dir);
        const outDir = await writeTwoPdfs(dir);
        const config = await loadSiteConfig(dir);

        // El roto está en la salida, pero fuera del alcance: no lo mira.
        const result = await runPdfxOutputValidation(outDir, config, { allowBuild: false }, undefined, undefined, ['bueno.pdf']);
        expect(result.failed).toBe(0);
        expect(result.summaryLine).toContain('1 PDF certifica PDF/X-1a');

        // Y el alcance sí valida lo que contiene: el roto, dentro, tumba.
        let mensaje = '';
        try {
          await runPdfxOutputValidation(outDir, config, { allowBuild: false }, undefined, undefined, ['roto.pdf']);
          expect.unreachable();
        } catch (err) {
          mensaje = err instanceof Error ? err.message : String(err);
        }
        expect(mensaje).toContain('1 de 1 PDFs no certifican PDF/X-1a.');
        expect(mensaje).toContain('roto.pdf');
      });
    });

    it('un alcance vacío no valida nada (corrida sin PDF) y las rutas que se salen de la salida se ignoran', async () => {
      await withTempDir(async (dir) => {
        useIsolatedManagedBin(dir);
        await initPdfxProject(dir);
        const outDir = await writeTwoPdfs(dir);
        const config = await loadSiteConfig(dir);

        expect(await runPdfxOutputValidation(outDir, config, { allowBuild: false }, undefined, undefined, [])).toEqual({
          validated: 0,
          failed: 0,
          summaryLine: undefined,
        });

        // Rutas inexistentes, absolutas o que escapan de la salida: nunca son
        // un fallo de esta corrida.
        expect(
          await runPdfxOutputValidation(outDir, config, { allowBuild: false }, undefined, undefined, [
            'no-existe.pdf',
            '../fuera.pdf',
            '/absoluta.pdf',
          ]),
        ).toEqual({ validated: 0, failed: 0, summaryLine: undefined });
      });
    });
  });

  it('anuncia la compilación del binario antes de intentar construirla (#2163)', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      const config = await loadSiteConfig(dir);
      // cargo ausente: buildPdfCheckBinary retorna null y la validación se
      // omite con aviso. El anuncio debe aparecer ANTES de ese aviso.
      const execSpy = spyOn(runLib, 'exec').mockRejectedValue(new ProcessSpawnError('cargo'));
      const stderrSpy = spyStderr();
      let output = '';
      try {
        const result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: true });
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(result).toEqual({ validated: 0, failed: 0, summaryLine: undefined });
      } finally {
        stderrSpy.mockRestore();
        execSpy.mockRestore();
      }
      expect(output).toContain('compilando iteraciones-pdfcheck');
      expect(output.indexOf('compilando iteraciones-pdfcheck')).toBeLessThan(output.indexOf('no se validaron'));
    });
  });

  it('salida no-JSON del binario se reporta como PDFCHECK_OUTPUT (#2499)', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      // El binario corre pero no devuelve JSON: es la rama de parseo, no la de spawn.
      await writeFakeBinary(dir, 'esto no es json');
      const config = await loadSiteConfig(dir);

      let thrown: unknown;
      try {
        await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain('no cumple PDF/X-1a');
      expect(message).toContain('[PDFCHECK_OUTPUT]');
      expect(message).toContain('salida inesperada del binario');
    });
  });

  it('el binario que no arranca se reporta como PDFCHECK_RUN (#2499)', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFakeBinary(dir, '{"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}');
      const config = await loadSiteConfig(dir);

      // El binario se resuelve, pero exec falla al lanzarlo.
      const execSpy = spyOn(runLib, 'exec').mockRejectedValue(new ProcessSpawnError('iteraciones-pdfcheck'));
      let thrown: unknown;
      try {
        await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false });
      } catch (err) {
        thrown = err;
      } finally {
        execSpy.mockRestore();
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toContain('[PDFCHECK_RUN]');
      expect(message).toContain('iteraciones-pdfcheck');
    });
  });

  it('caché PDF/X: el segundo build no invoca el validador y hereda la certificación (#2190)', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFakeBinary(dir, '{"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}');
      const config = await loadSiteConfig(dir);

      // Primer run: valida e informa la clave en out
      const prev: Record<string, string> = {};
      const out: Record<string, string> = {};
      let result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false }, undefined, {
        prev,
        out,
      });
      expect(result.validated).toBe(1);
      expect(Object.keys(out).length).toBe(1);

      // Segundo run con la caché heredada: 1 validado SIN invocar binario
      const out2: Record<string, string> = {};
      result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false }, undefined, {
        prev: { ...out },
        out: out2,
      });
      expect(result.validated).toBe(1);
      expect(result.summaryLine).toContain('1 PDF certifica');
      // La clave heredada se mantiene en out (los PDFs vigentes no pierden su certificación)
      expect(Object.keys(out2)).toEqual(Object.keys(out));
    });
  });

  it('caché PDF/X: cambiar la lista efectiva de preamble filters revalida (#2190)', async () => {
    await withTempDir(async (dir) => {
      useIsolatedManagedBin(dir);
      await initPdfxProject(dir);
      await mkdir(join(dir, 'dist', 'files'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'doc.pdf'), '%PDF-1.4 fake', 'utf8');
      await writeFakeBinary(dir, '{"valid": true, "level": "PDF/X-1a:2001", "errors": [], "warnings": []}');
      const config = await loadSiteConfig(dir);
      const prev: Record<string, string> = {};
      const out: Record<string, string> = {};
      await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false }, undefined, { prev, out });
      // Otra lista efectiva ⇒ claves distintas ⇒ revalida (out nuevo vacío)
      const out2: Record<string, string> = {};
      const result = await runPdfxOutputValidation(join(dir, 'dist', 'files'), config, { allowBuild: false }, ['98-crop', '99-otro'], {
        prev: { ...out },
        out: out2,
      });
      expect(result.validated).toBe(1);
      expect(Object.keys(out2).length).toBe(1);
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

  it('el restore borra XDG_CACHE_HOME cuando no estaba definida (#2467)', () => {
    const saved = process.env.XDG_CACHE_HOME;
    try {
      // Restaurando un snapshot en el que la variable no existía: con la
      // asignación antigua quedaría el literal "undefined" en el entorno.
      restoreXdgCacheHome(undefined);
      expect('XDG_CACHE_HOME' in process.env).toBe(false);

      // Y con la variable definida sí la devuelve tal cual.
      restoreXdgCacheHome('/tmp/caché-de-prueba');
      expect(process.env.XDG_CACHE_HOME).toBe('/tmp/caché-de-prueba');
    } finally {
      restoreXdgCacheHome(saved);
    }
  });
});
