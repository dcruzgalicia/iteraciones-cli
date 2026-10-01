import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logWarning } from '../lib/logger.js';
import type { DiscoveryEntry } from './types.js';

// Estos tres shapes viven aquí y no en sus consumidores: es el módulo al que
// todos importan, así que declararlos aquí es lo que rompe el ciclo con
// `state-hash` y `state-bib`, que los usan como valor por defecto.
export interface FileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export type FilterFileCache = Record<string, FileCacheEntry>;
export type BibFileCache = Record<string, FileCacheEntry>;
export type CssFileCache = Record<string, FileCacheEntry>;

const STATE_PATH = join('.iteraciones', 'state.json');

export const STATE_SCHEMA_VERSION = 2;

export interface BuildState {
  schemaVersion: number;
  startedAt: number;
  activeFormats: string[];
  outputDir?: string;
  filtersHash?: string;
  filterFileCache?: FilterFileCache;
  schemaFileCache?: Record<string, FileCacheEntry>;
  configHashes?: Record<string, string>;
  configFileCache?: Record<string, FileCacheEntry>;
  bibHash?: string;
  pdfxCache?: Record<string, string>;
  bibFileCache?: BibFileCache;
  cssHash?: string;
  cssFileCache?: CssFileCache;

  completed?: boolean;
  entries: Map<string, DiscoveryEntry>;
}

export function hashString(input: string): string {
  return Bun.CryptoHasher.hash('sha256', input, 'hex');
}

export async function hashFileContent(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return Bun.CryptoHasher.hash('sha256', bytes, 'hex');
}

export async function loadStateFile(cwd: string): Promise<BuildState | null> {
  const file = Bun.file(join(cwd, STATE_PATH));
  if (!(await file.exists())) return null;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<BuildState>;
    if (typeof parsed.startedAt !== 'number') return null;
    if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) return null;
    return {
      schemaVersion: parsed.schemaVersion,
      startedAt: parsed.startedAt,
      activeFormats: Array.isArray(parsed.activeFormats) ? parsed.activeFormats : [],
      outputDir: parsed.outputDir,
      filtersHash: parsed.filtersHash,
      filterFileCache: parsed.filterFileCache,
      schemaFileCache: parsed.schemaFileCache,
      configHashes: parsed.configHashes,
      configFileCache: parsed.configFileCache,
      bibHash: parsed.bibHash,
      bibFileCache: parsed.bibFileCache,
      pdfxCache: parsed.pdfxCache,
      cssHash: parsed.cssHash,
      cssFileCache: parsed.cssFileCache,
      completed: parsed.completed,
      entries: new Map(Object.entries((parsed.entries ?? {}) as Record<string, DiscoveryEntry>)),
    };
  } catch (err) {
    logWarning(`no se pudo leer state.json; se hará build completo: ${String(err)}`, 'cache');
    return null;
  }
}

export async function persistCompletedState(cwd: string, pending: BuildState | null): Promise<void> {
  if (!pending || pending.completed === true) return;
  pending.completed = true;
  await saveStateFile(cwd, pending);
}

export async function saveStateFile(cwd: string, state: BuildState): Promise<void> {
  const filePath = join(cwd, STATE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify({ ...state, schemaVersion: STATE_SCHEMA_VERSION, entries: Object.fromEntries(state.entries) }));
  try {
    await rename(tmpPath, filePath);
  } catch {
    await rm(filePath, { force: true });
    await rename(tmpPath, filePath);
  }
}
