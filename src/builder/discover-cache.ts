import { join } from 'node:path';
import { BuildError } from '../lib/errors.js';
import type { FileCacheEntry } from './state-hash.js';
import { cacheHitFor } from './state-hash.js';
import type { BibFileCache, FilterFileCache } from './state-serialize.js';
import { hashString, STATE_SCHEMA_VERSION } from './state-serialize.js';
import type { DiscoveryEntry } from './types.js';

export type CacheDecision = { process: false; touched?: boolean } | { process: true; text: string | null; hash?: string };

export interface DiscoverMeta {
  filtersHash: string;
  filterFileCache: FilterFileCache;
  schemaFileCache?: Record<string, FileCacheEntry>;
  configHashes: Record<string, string>;
  configFileCache?: Record<string, FileCacheEntry>;
  bibHash: string;
  bibFileCache: BibFileCache;
}

export async function resolveCacheDecision(
  cached: DiscoveryEntry | undefined,
  filePath: string,
  mtime: number,
  size: number,
): Promise<CacheDecision> {
  if (cached === undefined || cached.mtime === undefined || cached.size === undefined || cached.hash === undefined) {
    return { process: true, text: null };
  }
  if (cacheHitFor({ mtime: cached.mtime, size: cached.size, hash: cached.hash }, mtime, size) !== null) {
    return { process: false };
  }
  if (size !== cached.size) {
    return { process: true, text: null };
  }
  const text = await Bun.file(filePath).text();
  if (hashString(text) === cached.hash) {
    cached.mtime = mtime;
    return { process: false, touched: true };
  }
  return { process: true, text, hash: hashString(text) };
}

export async function statDocument(cwd: string, relativePath: string): Promise<{ mtime: number; size: number }> {
  try {
    const stat = await Bun.file(join(cwd, relativePath)).stat();
    return { mtime: Math.round(stat.mtimeMs), size: stat.size };
  } catch (err) {
    throw new BuildError(`Error al leer "${relativePath}": ${(err as Error).message}`);
  }
}

export function takeDeletedEntries(
  index: Map<string, DiscoveryEntry>,
  currentSet: Set<string>,
): { entries: Map<string, DiscoveryEntry>; removed: string[] } {
  const entries = new Map<string, DiscoveryEntry>();
  const removed: string[] = [];
  for (const key of index.keys()) {
    if (!currentSet.has(key)) {
      const entry = index.get(key);
      if (entry) entries.set(key, entry);
      removed.push(key);
    }
  }
  for (const key of removed) index.delete(key);
  return { entries, removed };
}

export interface DiscoverOptions {
  full?: boolean;
  activeFormats?: string[];
  prevState: import('./state-serialize.js').BuildState | null;
  outputDir?: string;
  meta?: DiscoverMeta;
}

export function stateHasChanged(
  useCache: boolean,
  prevState: import('./state-serialize.js').BuildState | null,
  options: DiscoverOptions,
  anyDocChanges: boolean,
): boolean {
  return (
    anyDocChanges ||
    !useCache ||
    options.outputDir !== prevState?.outputDir ||
    options.meta?.filtersHash !== prevState?.filtersHash ||
    JSON.stringify(options.meta?.filterFileCache) !== JSON.stringify(prevState?.filterFileCache) ||
    JSON.stringify(options.meta?.configHashes) !== JSON.stringify(prevState?.configHashes) ||
    options.meta?.bibHash !== prevState?.bibHash ||
    JSON.stringify(options.meta?.bibFileCache) !== JSON.stringify(prevState?.bibFileCache)
  );
}

export function computePendingState(
  useCache: boolean,
  prevState: import('./state-serialize.js').BuildState | null,
  startedAt: number,
  discoveryIndex: Map<string, DiscoveryEntry>,
  options: DiscoverOptions,
  anyDocChanges: boolean,
  anyTouches = false,
): import('./state-serialize.js').BuildState | null {
  if (!stateHasChanged(useCache, prevState, options, anyDocChanges || anyTouches)) return null;
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    startedAt,
    activeFormats: options.activeFormats ?? [],
    outputDir: options.outputDir,
    entries: discoveryIndex,
    filtersHash: options.meta?.filtersHash,
    filterFileCache: options.meta?.filterFileCache,
    schemaFileCache: options.meta?.schemaFileCache,
    configHashes: options.meta?.configHashes,
    configFileCache: options.meta?.configFileCache,
    bibHash: options.meta?.bibHash,
    bibFileCache: options.meta?.bibFileCache,
  };
}
