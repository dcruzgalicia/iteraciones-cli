import { exists } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

type CollectionFileResolution = { ok: true; rootRelative: string } | { ok: false; tried: string[] };

export async function resolveCollectionFile(file: string, collectionRelPath: string, cwd: string): Promise<CollectionFileResolution> {
  const fromCollection = join(cwd, dirname(collectionRelPath), file);
  const fromRoot = join(cwd, file);
  const candidates = fromCollection === fromRoot ? [fromCollection] : [fromCollection, fromRoot];
  for (const candidate of candidates) {
    if (await exists(candidate)) return { ok: true, rootRelative: relative(cwd, candidate) };
  }
  return { ok: false, tried: candidates };
}

export async function resolveCollectionFiles(files: string[], collectionRelPath: string, cwd: string): Promise<string[]> {
  const resolved: string[] = [];
  for (const file of files) {
    const resolution = await resolveCollectionFile(file, collectionRelPath, cwd);
    resolved.push(resolution.ok ? resolution.rootRelative : file);
  }
  return resolved;
}
