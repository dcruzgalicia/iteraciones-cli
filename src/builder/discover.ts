import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import slugifyLib from 'slugify';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import { listMarkdownDocuments } from './discover-files.js';
import type { FrontmatterIssue } from './discover-frontmatter.js';
import { parseDocument, throwIfInvalidFrontmatter } from './discover-frontmatter.js';
import { resolveSlugs } from './slug-resolver.js';
import type { FileCacheEntry } from './state-hash.js';
import { cacheHitFor } from './state-hash.js';
import { type BibFileCache, type BuildState, type FilterFileCache, hashString, STATE_SCHEMA_VERSION } from './state-serialize.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';

export type { FrontmatterIssue } from './discover-frontmatter.js';
export { parseAuthors } from './discover-frontmatter.js';

export type DiscoverResultAndPending = DiscoverResult & { pendingState: BuildState | null };

interface DiscoverResult {
  relativePaths: string[];
  changedPaths: Set<string>;
  discoveryIndex: Map<string, DiscoveryEntry>;
  deletedEntries: Map<string, DiscoveryEntry>;
  slugChangedEntries: Map<string, string>;
}

interface DiscoverMeta {
  filtersHash: string;
  filterFileCache: FilterFileCache;
  schemaFileCache?: Record<string, FileCacheEntry>;
  configHashes: Record<string, string>;
  configFileCache?: Record<string, FileCacheEntry>;
  bibHash: string;
  bibFileCache: BibFileCache;
}

interface DiscoverOptions {
  full?: boolean;
  activeFormats?: string[];
  prevState: BuildState | null;
  outputDir?: string;
  meta?: DiscoverMeta;
}

type CacheDecision = { process: false; touched?: boolean } | { process: true; text: string | null; hash?: string };

function slugify(text: string): string {
  const mapped = text.replace(/&/g, ' y ').replace(/%/g, ' por-ciento');
  return slugifyLib(mapped, { lower: true, strict: true });
}

export function computeSlug(
  frontmatter: { title?: string; creator?: string[] },
  options?: { fallbackPath?: string; maxCreators?: number },
): string | undefined {
  const maxCreators = options?.maxCreators ?? 1;
  const creators = frontmatter.creator?.filter(Boolean).slice(0, maxCreators);

  const base = frontmatter.title ? slugify(frontmatter.title) : options?.fallbackPath ? slugify(basename(options.fallbackPath, '.md')) : undefined;
  if (!base) return undefined;

  if (!creators || creators.length === 0) return base;

  const creatorSlug = creators.map((a) => slugify(a)).join('-y-');
  return `${base}-por-${creatorSlug}`;
}

function slugDiacriticWarning(title: string, slug: string): string | undefined {
  if (!/[ñü]/i.test(title)) return undefined;
  if (slug.includes('ñ') || slug.includes('ü')) return undefined;
  return `el slug "${slug}" altera palabras del título "${title}" (ñ→n, ü→u): revísalo o fija uno manual con "slug:" en el frontmatter`;
}

async function resolveCacheDecision(cached: DiscoveryEntry | undefined, filePath: string, mtime: number, size: number): Promise<CacheDecision> {
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

async function statDocument(cwd: string, relativePath: string): Promise<{ mtime: number; size: number }> {
  try {
    const stat = await Bun.file(join(cwd, relativePath)).stat();
    return { mtime: Math.round(stat.mtimeMs), size: stat.size };
  } catch (err) {
    throw new BuildError(`Error al leer "${relativePath}": ${(err as Error).message}`);
  }
}

function takeDeletedEntries(
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

function stateHasChanged(useCache: boolean, prevState: BuildState | null, options: DiscoverOptions, anyDocChanges: boolean): boolean {
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

function computePendingState(
  useCache: boolean,
  prevState: BuildState | null,
  startedAt: number,
  discoveryIndex: Map<string, DiscoveryEntry>,
  options: DiscoverOptions,
  anyDocChanges: boolean,
  anyTouches = false,
): BuildState | null {
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

export async function discover(cwd: string, options: DiscoverOptions): Promise<DiscoverResultAndPending> {
  const relativePaths = await listMarkdownDocuments(cwd);

  const useCache = !options.full;
  const prevState = options.prevState;
  const discoveryIndex = useCache ? (prevState?.entries ?? new Map<string, DiscoveryEntry>()) : new Map<string, DiscoveryEntry>();

  const currentSet = new Set(relativePaths);
  const changedPaths = new Set<string>();
  const slugWarningsSeen = new Set<string>();
  const frontmatterIssues: FrontmatterIssue[] = [];

  const thisBuildStartedAt = Date.now();
  let touchedCount = 0;

  const FILE_IO_CONCURRENCY = Math.max(1, cpus().length - 1);
  await mapWithConcurrency(relativePaths, FILE_IO_CONCURRENCY, async (relativePath) => {
    const { mtime, size } = await statDocument(cwd, relativePath);
    const cached = useCache ? discoveryIndex.get(relativePath) : undefined;
    const decision = await resolveCacheDecision(cached, join(cwd, relativePath), mtime, size);
    if (!decision.process) {
      if (decision.touched) touchedCount++;
      return;
    }

    changedPaths.add(relativePath);
    await parseDocument({
      cwd,
      relativePath,
      filePath: join(cwd, relativePath),
      mtime,
      size,
      cachedSlug: discoveryIndex.get(relativePath)?.slug,
      decisionText: decision.text,
      decisionHash: decision.hash,
      index: discoveryIndex,
      issues: frontmatterIssues,
    });
  });

  const { entries: deletedEntries, removed: deletedFiles } = takeDeletedEntries(discoveryIndex, currentSet);
  for (const key of deletedFiles) changedPaths.add(key);

  throwIfInvalidFrontmatter(frontmatterIssues);

  const slugResult = resolveSlugs(discoveryIndex, (meta, opts) => {
    const slug = computeSlug(meta, opts);
    if (slug === undefined) throw new BuildError(`no se pudo resolver el slug de ${opts.fallbackPath}`);
    if (meta.title) {
      const diacriticHint = slugDiacriticWarning(meta.title, slug);
      if (diacriticHint && !slugWarningsSeen.has(diacriticHint)) {
        slugWarningsSeen.add(diacriticHint);
        logWarning(diacriticHint, 'discover');
      }
    }
    return slug;
  });
  const slugChangedEntries = new Map<string, string>(slugResult.slugChangedEntries);
  for (const path of slugResult.changedPaths) changedPaths.add(path);

  const pendingState = computePendingState(useCache, prevState, thisBuildStartedAt, discoveryIndex, options, changedPaths.size > 0, touchedCount > 0);

  return { relativePaths, changedPaths, discoveryIndex, deletedEntries, slugChangedEntries, pendingState };
}

export function buildDocsFromIndex(relativePaths: string[], discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): BuildDocument[] {
  return relativePaths.map((relativePath) => {
    const entry = discoveryIndex.get(relativePath);
    return {
      filePath: join(cwd, relativePath),
      relativePath,
      frontmatter: {
        title: entry?.title || 'Sin título',
        subtitle: entry?.subtitle,
        date: entry?.date ?? '',
        creator: entry?.creator ?? [],
        type: entry?.type,
        files: entry?.files,
      },
    };
  });
}

export function htmlSlugFor(relativePath: string, slug: string | undefined): string {
  return basename(relativePath) === 'index.md' ? 'index' : (slug ?? basename(relativePath, '.md'));
}
