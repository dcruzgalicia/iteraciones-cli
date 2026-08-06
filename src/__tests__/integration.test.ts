import { describe, expect, it } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../builder/orchestrator.js';
import { runInit } from '../cli/init.js';
import { checkPandoc } from '../lib/pandoc-runner.js';

describe('integration: init + build', () => {
  it('genera HTML después de init + build', async () => {
    // Verificar que pandoc está disponible; si no, omitir el test de integración
    const pandocOk = await checkPandoc().catch(() => null);
    if (!pandocOk) {
      // pandoc no instalado en este entorno — no es un fallo del test
      return;
    }

    const cwd = join(tmpdir(), `iteraciones-integration-test-${Date.now()}`);
    await mkdir(cwd, { recursive: true });
    try {
      // 1. Inicializar el proyecto
      await runInit(cwd);

      // Verificar que se crearon los archivos base
      const configFile = Bun.file(join(cwd, 'iteraciones.config.yaml'));
      expect(await configFile.exists()).toBe(true);
      const readmeFile = Bun.file(join(cwd, 'README.md'));
      expect(await readmeFile.exists()).toBe(true);

      // 2. Build (solo HTML por defecto, sin caché)
      await build(cwd, { noCache: true });

      // 3. Verificar que se generó HTML (el slug depende del frontmatter de README.md)
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
