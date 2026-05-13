import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapWithConcurrency } from '../../output/concurrency.js';
import { convertFragment } from '../../services/pandoc-runner.js';
import type { BuildDocument } from '../types.js';

export async function renderDocuments(docs: BuildDocument[], concurrency: number): Promise<BuildDocument[]> {
  return mapWithConcurrency(docs, concurrency, async (doc) => {
    const tmpPath = join(tmpdir(), `iteraciones-${doc.sourceHash}-${crypto.randomUUID()}.md`);
    try {
      await writeFile(tmpPath, doc.body, 'utf8');
      const htmlFragment = await convertFragment(tmpPath);
      return { ...doc, htmlFragment };
    } finally {
      await rm(tmpPath, { force: true });
    }
  });
}
