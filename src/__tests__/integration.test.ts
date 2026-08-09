import { describe, expect, it } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../builder/orchestrator.js';
import { runInit } from '../cli/init.js';
import { checkPandoc } from '../lib/pandoc-runner.js';

// Sin pandoc el test de integración no puede correr: se marca como skip real
// (antes hacía return temprano y la suite reportaba "pass" sin probar nada).
const pandocOk = await checkPandoc().catch(() => null);

describe('integration: init + build', () => {
  it.skipIf(!pandocOk)('genera HTML después de init + build', async () => {
    const cwd = join(tmpdir(), `iteraciones-integration-test-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      // 1. Inicializar el proyecto
      await runInit(cwd);

      // Verificar que se crearon los archivos base
      const configFile = Bun.file(join(cwd, 'iteraciones.config.yaml'));
      expect(await configFile.exists()).toBe(true);
      const indexFile = Bun.file(join(cwd, 'index.md'));
      expect(await indexFile.exists()).toBe(true);

      // 2. Build (solo HTML por defecto, sin caché)
      await build(cwd, { noCache: true });

      // 3. Verificar que se generó el home (index.md → index.html) y HTML en general
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
});
