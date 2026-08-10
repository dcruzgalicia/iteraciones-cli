import { describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../builder/orchestrator.js';
import { runNew } from '../cli/dispatcher.js';
import { runInit } from '../cli/init.js';
import { runValidate } from '../cli/validate.js';
import { checkPandoc } from '../lib/pandoc-runner.js';
import { initTestProject } from './helpers.js';

// Sin pandoc el test de integración no puede correr: se marca como skip real
// (antes hacía return temprano y la suite reportaba "pass" sin probar nada).
const pandocOk = await checkPandoc().catch(() => null);

describe('integration: init + build', () => {
  it.skipIf(!pandocOk)('genera HTML después de init + build', async () => {
    const cwd = join(tmpdir(), `iteraciones-integration-test-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      await runInit(cwd);

      const configFile = Bun.file(join(cwd, 'iteraciones.config.yaml'));
      expect(await configFile.exists()).toBe(true);
      const indexFile = Bun.file(join(cwd, 'index.md'));
      expect(await indexFile.exists()).toBe(true);

      await build(cwd, { full: true });

      expect(await Bun.file(join(cwd, 'dist', 'files', 'index.html')).exists()).toBe(true);
      let found = false;
      for await (const _entry of new Bun.Glob('*.html').scan({ cwd: join(cwd, 'dist', 'files') })) {
        found = true;
        break;
      }
      expect(found).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(!pandocOk)('build incremental: reutiliza documentos sin cambios', async () => {
    const cwd = join(tmpdir(), `iteraciones-incr-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      await initTestProject(cwd);
      // Primer build
      await build(cwd, { full: true });
      expect(await Bun.file(join(cwd, 'dist', 'files', 'test-document.html')).exists()).toBe(true);

      // Segundo build sin cambios: el archivo no debe reescribirse
      const mtimeBefore = (await Bun.file(join(cwd, 'dist', 'files', 'test-document.html')).stat()).mtimeMs;
      await build(cwd);
      const mtimeAfter = (await Bun.file(join(cwd, 'dist', 'files', 'test-document.html')).stat()).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore); // no se reescribió
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(!pandocOk)('invalidación por cambio de configuración', async () => {
    const cwd = join(tmpdir(), `iteraciones-inval-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      await initTestProject(cwd);
      await build(cwd, { full: true });

      // Cambiar el theme en la config - reescribir el archivo completo
      const newConfig = ['lang: es-MX', 'format:', '  html:', '    title: Test', '    generate: true', '    theme: light'].join('\n');
      await Bun.write(join(cwd, 'iteraciones.config.yaml'), newConfig);

      // El segundo build debe reprocesar por cambio de config
      await build(cwd);
      expect(await Bun.file(join(cwd, 'dist', 'files', 'test-document.html')).exists()).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(!pandocOk)('build con múltiples documentos', async () => {
    const cwd = join(tmpdir(), `iteraciones-multi-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      await runInit(cwd);
      // Crear documentos adicionales con el comando new
      await runNew(cwd, 'capitulo-1.md', { title: 'Capítulo 1' });
      await runNew(cwd, 'capitulo-2.md', { title: 'Capítulo 2' });

      await build(cwd, { full: true });

      // Verificar que todos los HTML existen
      expect(await Bun.file(join(cwd, 'dist', 'files', 'index.html')).exists()).toBe(true);
      expect(await Bun.file(join(cwd, 'dist', 'files', 'capitulo-1.html')).exists()).toBe(true);
      expect(await Bun.file(join(cwd, 'dist', 'files', 'capitulo-2.html')).exists()).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('validate detecta errores de frontmatter', async () => {
    const cwd = join(tmpdir(), `iteraciones-val-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      await initTestProject(cwd);
      // Crear un documento con YAML inválido
      await writeFile(join(cwd, 'bad.md'), '---\ntitle: "sin cerrar\n---\n\nContenido.\n', 'utf8');

      // validate setea process.exitCode en lugar de lanzar
      const prevExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        await runValidate(cwd);
      } catch {
        // ignorado
      }
      const hadError = process.exitCode === 1;
      process.exitCode = prevExitCode;
      // validate debe reportar al menos el error de YAML inválido
      expect(hadError).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it.skipIf(!pandocOk)('--dry-run no genera archivos de salida', async () => {
    const cwd = join(tmpdir(), `iteraciones-dry-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      await initTestProject(cwd);
      await build(cwd, { dryRun: true });

      // dry-run no debe crear dist/
      const distExists = await Bun.file(join(cwd, 'dist', 'files', 'test-document.html')).exists();
      expect(distExists).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
