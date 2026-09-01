import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import slugifyLib from 'slugify';
import { BUILD_ERROR_CODES, BuildError, formatUserError, translateSystemError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, fmTrimmedString } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { mapWithConcurrency } from '../lib/run.js';
import { listMarkdownDocuments } from './gitignore.js';
import { looseColonLines, looseColonsMessage, MISSING_TITLE_WARNING, validateFrontmatterFields } from './project-validator.js';
import { resolveSlugs } from './slug-resolver.js';
import type { FileCacheEntry } from './state-hash.js';
import { cacheHitFor } from './state-hash.js';
import {
  type BibFileCache,
  type BuildState,
  type FilterFileCache,
  hashString,
  loadStateFile,
  STATE_SCHEMA_VERSION,
  stateUsableForBuild,
} from './state-serialize.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';

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

type FrontmatterIssue = { file: string; error: string; kind: 'syntax' | 'field' };

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

export async function loadPrevState(cwd: string): Promise<BuildState | null> {
  return stateUsableForBuild(await loadStateFile(cwd));
}

export function noPrevState(): BuildState | null {
  return null;
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
    throw new BuildError(`Error al leer "${relativePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
  }
}

interface IngestedFrontmatter {
  title: string;
  subtitle: string | undefined;
  date: string | undefined;
  creator: string[];
  manualSlug: string | undefined;
  type: 'file' | 'collection' | undefined;
  files: string[] | undefined;
  fm: Record<string, unknown> | undefined;
}

interface NormalizedRecord extends Omit<IngestedFrontmatter, 'fm'> {
  rawTitle: unknown;
}

function normalizeFrontmatterRecord(record: Record<string, unknown>, relativePath: string, issues: FrontmatterIssue[]): NormalizedRecord {
  for (const issue of validateFrontmatterFields(record)) {
    if (issue.severity === 'error') {
      issues.push({ file: relativePath, error: issue.message, kind: 'field' });
    } else {
      logWarning(`${relativePath}: ${issue.message}`, 'discover');
    }
  }
  const rawTitle = record.title;
  const type = record.type === 'file' || record.type === 'collection' ? record.type : undefined;
  const files = Array.isArray(record.files) && record.files.every((f) => typeof f === 'string') ? (record.files as string[]) : undefined;
  return {
    title: typeof rawTitle === 'string' ? rawTitle : '',
    subtitle: fmTrimmedString(record.subtitle),
    date: fmTrimmedString(record.date),
    creator: parseAuthors(record.creator),
    manualSlug: fmTrimmedString(record.slug),
    type,
    files,
    rawTitle,
  };
}

function lacksTitle(normalized: NormalizedRecord | undefined, title: string): boolean {
  return !title && (!normalized || normalized.rawTitle === undefined || normalized.rawTitle === '');
}

function ingestFrontmatter(relativePath: string, text: string, issues: FrontmatterIssue[]): IngestedFrontmatter {
  const { yaml, body } = splitFrontmatter(text);
  let normalized: NormalizedRecord | undefined;
  let fm: Record<string, unknown> | undefined;

  try {
    if (yaml) {
      const yamlResult = parseYamlWithPosition(yaml);
      if (yamlResult.error) throw new Error(yamlResult.error);
      const parsed = yamlResult.value;
      if (parsed && Array.isArray(parsed)) {
        issues.push({ file: relativePath, error: 'frontmatter YAML inválido: debe ser un objeto', kind: 'syntax' });
      } else if (parsed && typeof parsed === 'object') {
        fm = parsed as Record<string, unknown>;
        normalized = normalizeFrontmatterRecord(fm, relativePath, issues);
      }
    }
  } catch (err) {
    issues.push({ file: relativePath, error: formatUserError(err), kind: 'syntax' });
  }

  const lineOffset = text.slice(0, text.length - body.length).split('\n').length - 1;
  const looseColons = looseColonLines(body, lineOffset);
  if (looseColons.length > 0) {
    logWarning(`${relativePath}: ${looseColonsMessage(looseColons)}`, 'discover');
  }

  const title = normalized?.title ?? '';
  if (lacksTitle(normalized, title)) {
    logWarning(`${relativePath}: ${MISSING_TITLE_WARNING.message}`, 'discover');
  }

  return {
    title,
    subtitle: normalized?.subtitle,
    date: normalized?.date,
    creator: normalized?.creator ?? [],
    manualSlug: normalized?.manualSlug,
    type: normalized?.type,
    files: normalized?.files,
    fm,
  };
}

async function readDocumentText(filePath: string, relativePath: string, pending: string | null): Promise<string> {
  if (pending !== null) return pending;
  try {
    return await Bun.file(filePath).text();
  } catch (err) {
    throw new BuildError(`Error al leer "${relativePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
  }
}

async function ingestChangedDocument(args: {
  cwd: string;
  relativePath: string;
  filePath: string;
  mtime: number;
  size: number;
  cachedSlug: string | undefined;
  decisionText: string | null;
  decisionHash: string | undefined;
  index: Map<string, DiscoveryEntry>;
  issues: FrontmatterIssue[];
}): Promise<void> {
  const { relativePath, filePath, mtime, size, decisionText, decisionHash } = args;
  const text = await readDocumentText(filePath, relativePath, decisionText);
  const ingested = ingestFrontmatter(relativePath, text, args.issues);
  args.index.set(relativePath, {
    ...ingested,
    mtime,
    size,
    hash: decisionHash ?? hashString(text),
    slug: args.cachedSlug,
  });
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
      if (entry) entries.set(key, entry); // la entrada ya lleva el slug resuelto
      removed.push(key);
    }
  }
  for (const key of removed) index.delete(key);
  return { entries, removed };
}

function throwIfInvalidFrontmatter(issues: FrontmatterIssue[]): void {
  if (issues.length === 0) return;
  const blocks: string[] = [];
  for (const kind of ['syntax', 'field'] as const) {
    const byKind = issues.filter((e) => e.kind === kind);
    if (byKind.length === 0) continue;
    const label = kind === 'syntax' ? 'frontmatter YAML inválido' : 'frontmatter inválido';
    const msg = byKind.map((e) => `  ${e.file}: ${e.error}`).join('\n');
    blocks.push(`${label} en ${plural(byKind.length, 'documento')}:\n${msg}`);
  }
  const hasSyntax = issues.some((e) => e.kind === 'syntax');
  throw new BuildError(blocks.join('\n'), hasSyntax ? BUILD_ERROR_CODES.frontmatterSyntax : undefined);
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
      return; // Archivos sin cambios: conservan su entrada en discoveryIndex
    }

    changedPaths.add(relativePath);
    await ingestChangedDocument({
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
        title: entry?.title || 'Sin t\u00edtulo',
        subtitle: entry?.subtitle,
        date: entry?.date ?? '',
        creator: entry?.creator ?? [],
        type: entry?.type,
        files: entry?.files,
      },
    };
  });
}

export function parseAuthors(raw: unknown): string[] {
  return fmStringList(raw) ?? [];
}

export function htmlSlugFor(relativePath: string, slug: string | undefined): string {
  return basename(relativePath) === 'index.md' ? 'index' : (slug ?? basename(relativePath, '.md'));
}
