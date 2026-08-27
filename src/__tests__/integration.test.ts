import { describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../builder/orchestrator.js';
import { runNew } from '../cli/dispatcher.js';
import { initProject } from '../cli/init.js';
import { validateProject } from '../cli/validate.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { initTestProject, registerSkip, SKIP_REASONS } from './helpers.js';

// Sin pandoc el test de integración no puede correr: se marca como skip real
// (antes hacía return temprano y la suite reportaba "pass" sin probar nada).
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('integration.test.ts', SKIP_REASONS.pandoc);

describe('integration: init + build', () => {
  it.skipIf(!pandocOk)('genera HTML después de init + build', async () => {
    const cwd = join(tmpdir(), `iteraciones-integration-test-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      await initProject(cwd);

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
      const newConfig = ['language: es-MX', 'format:', '  html:', '    site:', '      title: Test', '      theme: light', '    generate: true'].join(
        '\n',
      );
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
      await initProject(cwd);
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
        await validateProject(cwd);
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

  it.skipIf(!pandocOk)('un build que falla preserva el state.json del último build completo (#2168)', async () => {
    const cwd = join(tmpdir(), `iteraciones-cache-preserve-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      await initTestProject(cwd);
      await build(cwd, { full: true });
      const stateFile = join(cwd, '.iteraciones', 'state.json');
      const estadoPrevio = await Bun.file(stateFile).text();
      expect(estadoPrevio.length).toBeGreaterThan(0);

      // El build siguiente falla (bibliografía configurada inexistente: error
      // de config previo a discovery) y el estado debe seguir intacto.
      const config = await Bun.file(join(cwd, 'iteraciones.config.yaml')).text();
      await writeFile(join(cwd, 'iteraciones.config.yaml'), `${config}\nbibliography: refs/no-existe.bib\n`, 'utf8');
      await expect(build(cwd, {})).rejects.toThrow();
      expect(await Bun.file(stateFile).text()).toBe(estadoPrevio);

      // Corregida la config, el build siguiente reutiliza la caché preservada
      await writeFile(join(cwd, 'iteraciones.config.yaml'), config, 'utf8');
      await build(cwd, {});
      const htmls = [...new Bun.Glob('*.html').scanSync({ cwd: join(cwd, 'dist', 'files') })];
      expect(htmls.length).toBeGreaterThan(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
