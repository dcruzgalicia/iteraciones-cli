import { exists } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export type CollectionFileResolution = { ok: true; rootRelative: string } | { ok: false; tried: string[] };

export async function resolveCollectionFile(file: string, collectionRelPath: string, cwd: string): Promise<CollectionFileResolution> {
  const fromCollection = join(cwd, dirname(collectionRelPath), file);
  const fromRoot = join(cwd, file);
  const candidates = fromCollection === fromRoot ? [fromCollection] : [fromCollection, fromRoot];
  for (const candidate of candidates) {
    if (await exists(candidate)) return { ok: true, rootRelative: relative(cwd, candidate) };
  }
  return { ok: false, tried: candidates };
}
