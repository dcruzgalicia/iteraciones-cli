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
  pandocVersion: string;
}

export async function renderDocuments(docs: BuildDocument[], concurrency: number, cache?: RenderCache): Promise<BuildDocument[]> {
  return mapWithConcurrency(docs, concurrency, async (doc) => {
    if (cache) {
      const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion);
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
        const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion);
        await cache.manager.write('render', key, htmlFragment);
      }
      return { ...doc, htmlFragment };
    } finally {
      await rm(tmpPath, { force: true });
    }
  });
}
