import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import { convertFragment } from '../../services/pandoc-runner.js';
import type { BuildDocument } from '../types.js';

export interface RenderCache {
  manager: CacheManager;
  cliVersion: string;
  pandocVersion: string;
}

export async function renderDocuments(
  docs: BuildDocument[],
  concurrency: number,
  cache?: RenderCache,
  registry?: PluginRegistry,
): Promise<BuildDocument[]> {
  return mapWithConcurrency(docs, concurrency, async (doc) => {
    if (cache) {
      const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion);
      const cached = await cache.manager.read('render', key);
      if (cached !== undefined) {
        return { ...doc, htmlFragment: cached };
      }
    }

    // beforeRender: las variables retornadas no se pasan a pandoc en la implementación
    // actual (convertFragment no acepta variables); el hook sirve como punto de
    // observación del ciclo de renderizado.
    if (registry) {
      await registry.runBeforeRender({ sourcePath: doc.filePath, variables: {} });
    }

    const tmpPath = join(tmpdir(), `iteraciones-${doc.sourceHash}-${crypto.randomUUID()}.md`);
    try {
      await writeFile(tmpPath, doc.body, 'utf8');
      let htmlFragment = await convertFragment(tmpPath);

      if (registry) {
        const afterCtx = await registry.runAfterRender({ sourcePath: doc.filePath, html: htmlFragment });
        htmlFragment = afterCtx.html;
      }

      if (cache) {
        const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion);
        await cache.manager.write('render', key, htmlFragment);
      }
      return { ...doc, htmlFragment };
    } finally {
      await rm(tmpPath, { force: true });
    }
  });
}
