import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import slugifyLib from 'slugify';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import type { DiscoverOptions } from './discover-cache.js';
import { computePendingState, resolveCacheDecision, statDocument, takeDeletedEntries } from './discover-cache.js';
import { listMarkdownDocuments } from './discover-files.js';
import type { FrontmatterIssue } from './discover-frontmatter.js';
import { parseDocument, throwIfInvalidFrontmatter } from './discover-frontmatter.js';
import { resolveSlugs } from './slug-resolver.js';
import type { BuildState } from './state-serialize.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';

export type { DiscoverMeta, DiscoverOptions } from './discover-cache.js';
export type { FrontmatterIssue } from './discover-frontmatter.js';
export { parseAuthors } from './discover-frontmatter.js';

export type SlugComputer = (meta: { title: string; creator: string[] }, opts: { fallbackPath: string; maxCreators?: number }) => string;

export type DiscoverResultAndPending = DiscoverResult & { pendingState: BuildState | null };

interface DiscoverResult {
  relativePaths: string[];
  changedPaths: Set<string>;
  discoveryIndex: Map<string, DiscoveryEntry>;
  deletedEntries: Map<string, DiscoveryEntry>;
  slugComputer: SlugComputer;
}

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

  const slugComputer = (meta: { title: string; creator: string[] }, opts: { fallbackPath: string; maxCreators?: number }) => {
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
  };

  const pendingState = computePendingState(useCache, prevState, thisBuildStartedAt, discoveryIndex, options, changedPaths.size > 0, touchedCount > 0);

  return { relativePaths, changedPaths, discoveryIndex, deletedEntries, slugComputer, pendingState };
}

export function resolveDiscoverSlugs(
  discoveryIndex: Map<string, DiscoveryEntry>,
  slugComputer: SlugComputer,
): { slugChangedEntries: Map<string, string>; changedPaths: Set<string> } {
  const slugResult = resolveSlugs(discoveryIndex, slugComputer);
  return { slugChangedEntries: slugResult.slugChangedEntries, changedPaths: new Set(slugResult.changedPaths) };
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
