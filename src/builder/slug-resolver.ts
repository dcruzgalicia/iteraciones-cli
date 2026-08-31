import { dirname } from 'node:path';
import { BuildError } from '../lib/errors.js';
import type { DiscoveryEntry } from './types.js';

interface SlugResolutionResult {
  slugChangedEntries: Map<string, string>;
  changedPaths: string[];
}

interface SlugChangeAccumulator {
  slugChangedEntries: Map<string, string>;
  changedPaths: string[];
}

type SlugComputer = (meta: { title: string; creator: string[] }, opts: { fallbackPath: string; maxCreators?: number }) => string;

function entryFor(discoveryIndex: Map<string, DiscoveryEntry>, path: string): DiscoveryEntry {
  const entry = discoveryIndex.get(path);
  if (entry === undefined) throw new Error(`sin entrada de discovery para ${path}`);
  return entry;
}

function recordSlugChange(acc: SlugChangeAccumulator, relPath: string, prevSlug: string): void {
  acc.changedPaths.push(relPath);
  acc.slugChangedEntries.set(relPath, prevSlug);
}

function applyManualSlugs(discoveryIndex: Map<string, DiscoveryEntry>, acc: SlugChangeAccumulator): void {
  for (const [relPath, entry] of discoveryIndex) {
    const newSlug = entry.manualSlug;
    if (newSlug === undefined) continue;
    if (entry.slug && entry.slug !== newSlug) recordSlugChange(acc, relPath, entry.slug);
    entry.slug = newSlug;
  }
}

function groupBySlugBase(discoveryIndex: Map<string, DiscoveryEntry>, computeSlug: SlugComputer): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [relPath, entry] of discoveryIndex) {
    if (entry.manualSlug !== undefined) continue;
    const slugBase = computeSlug({ title: entry.title, creator: entry.creator }, { fallbackPath: relPath });
    const dir = dirname(relPath);
    const key = dir === '.' ? slugBase : `${dir}/${slugBase}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)?.push(relPath);
  }
  return groups;
}

function resolveGroupUnique(discoveryIndex: Map<string, DiscoveryEntry>, path: string, slugBase: string, acc: SlugChangeAccumulator): void {
  const entry = entryFor(discoveryIndex, path);
  const prevSlug = entry.slug;
  const keepSuffix = prevSlug?.match(/^(.*)-d(\d+)$/);
  if (!(keepSuffix && keepSuffix[1] === slugBase)) {
    if (prevSlug && prevSlug !== slugBase) recordSlugChange(acc, path, prevSlug);
    entry.slug = slugBase;
  }
}

function suffixNumber(slug: string | undefined): number | undefined {
  if (!slug) return undefined;
  const m = slug.match(/-d(\d+)$/);
  return m ? parseInt(m[1] ?? '0', 10) : undefined;
}

function resolveGroupCollision(discoveryIndex: Map<string, DiscoveryEntry>, paths: string[], slugBase: string, acc: SlugChangeAccumulator): void {
  paths.sort();
  let maxN = 0;
  const retained = new Map<string, string>();
  for (const path of paths) {
    const entry = entryFor(discoveryIndex, path);
    const n = suffixNumber(entry.slug);
    if (n !== undefined && entry.slug !== undefined) {
      if (n > maxN) maxN = n;
      retained.set(path, entry.slug);
    }
  }
  let nextN = maxN + 1;
  for (const path of paths) {
    const entry = entryFor(discoveryIndex, path);
    const retainedSlug = retained.get(path);
    const newSlug = retainedSlug ?? `${slugBase}-d${nextN}`;
    if (retainedSlug === undefined) nextN++;
    if (entry.slug && entry.slug !== newSlug) recordSlugChange(acc, path, entry.slug);
    entry.slug = newSlug;
  }
}

function resolveGroup(discoveryIndex: Map<string, DiscoveryEntry>, slugBase: string, paths: string[], acc: SlugChangeAccumulator): void {
  if (paths.length <= 1) {
    const path = paths[0];
    if (path === undefined) throw new Error('slug-resolver: grupo de slugs vacío');
    resolveGroupUnique(discoveryIndex, path, slugBase, acc);
  } else {
    resolveGroupCollision(discoveryIndex, paths, slugBase, acc);
  }
}

function assertNoOutputCollisions(discoveryIndex: Map<string, DiscoveryEntry>): void {
  const owners = new Map<string, string>();
  const collisions: string[] = [];
  for (const [relPath, entry] of discoveryIndex) {
    if (!entry.slug) continue;
    const outputKey = `${dirname(relPath)}/${entry.slug}`;
    const owner = owners.get(outputKey);
    if (owner !== undefined) collisions.push(`${owner} y ${relPath} → "${entry.slug}"`);
    else owners.set(outputKey, relPath);
  }
  if (collisions.length > 0) {
    throw new BuildError(`slugs duplicados: ${collisions.join('; ')}`);
  }
}

export function resolveSlugs(discoveryIndex: Map<string, DiscoveryEntry>, computeSlug: SlugComputer): SlugResolutionResult {
  const acc: SlugChangeAccumulator = { slugChangedEntries: new Map(), changedPaths: [] };

  applyManualSlugs(discoveryIndex, acc);

  for (const [key, paths] of groupBySlugBase(discoveryIndex, computeSlug)) {
    const slugBase = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
    resolveGroup(discoveryIndex, slugBase, paths, acc);
  }

  assertNoOutputCollisions(discoveryIndex);

  return acc;
}
