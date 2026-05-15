import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import { convertFragment } from '../../services/pandoc-runner.js';
import type { BuildDocument } from '../types.js';

export interface RenderCache {
  manager: CacheManager;
  cliVersion: string;
}

export async function renderDocuments(docs: BuildDocument[], concurrency: number, cache?: RenderCache): Promise<BuildDocument[]> {
  // Pre-computar las claves activas para el pruning al final.
  const activeKeys = cache ? new Set(docs.map((doc) => hash(doc.sourceHash, cache.cliVersion))) : undefined;

  const rendered = await mapWithConcurrency(docs, concurrency, async (doc) => {
    if (cache) {
      const key = hash(doc.sourceHash, cache.cliVersion);
      const cached = await cache.manager.read('render', key);
      if (cached !== undefined) {
        return { ...doc, htmlFragment: cached };
      }
    }

    const tmpPath = join(tmpdir(), `iteraciones-${doc.sourceHash}-${crypto.randomUUID()}.md`);
    try {
      await writeFile(tmpPath, doc.body, 'utf8');
      const htmlFragment = await convertFragment(tmpPath);
      if (cache) {
        const key = hash(doc.sourceHash, cache.cliVersion);
        await cache.manager.write('render', key, htmlFragment);
      }
      return { ...doc, htmlFragment };
    } finally {
      await rm(tmpPath, { force: true });
    }
  });

  // Eliminar entradas obsoletas del scope 'render'.
  if (cache && activeKeys) {
    await cache.manager.prune('render', activeKeys);
  }

  return rendered;
}
