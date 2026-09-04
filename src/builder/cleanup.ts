import { readdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import type { FormatKey } from '../config/site-config.js';
import { resolveBooleanField } from '../lib/frontmatter-fields.js';
import { htmlSlugFor } from './discover.js';
import { LATEXMK_AUX_EXTENSIONS } from './export/runner.js';
import { ALL_OUTPUT_EXTENSIONS, FORMAT_OUTPUT_EXTENSIONS } from './output-layout.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

async function removeIfExists(path: string): Promise<boolean> {
  try {
    await rm(path, { force: true });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw err;
  }
}

async function pruneEmptyDirs(outputDir: string): Promise<void> {
  const dirs: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await readdir(join(outputDir, rel), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const childRel = rel === '.' ? entry.name : `${rel}/${entry.name}`;
      dirs.push(childRel);
      await walk(childRel);
    }
  };
  await walk('.');
  for (const dir of dirs.reverse()) {
    const remaining = await readdir(join(outputDir, dir)).catch(() => ['x']);
    if (remaining.length === 0) await rm(join(outputDir, dir), { force: true }).catch(() => {});
  }
}

async function removeCachedArtifacts(cacheBase: string, dir: string, slug: string): Promise<number> {
  let removed = 0;
  if (await removeIfExists(join(cacheBase, 'tmp', 'pdf', dir, `${slug}.tex`))) removed++;
  const workDir = join(cacheBase, 'tmp', 'pdf', dir);
  const targets: string[] = [''];
  try {
    const entries = await readdir(workDir, { withFileTypes: true });
    for (const e of entries) if (e.isDirectory() && e.name.startsWith('slot-')) targets.push(e.name);
  } catch {}
  for (const sub of targets) {
    for (const ext of LATEXMK_AUX_EXTENSIONS) {
      if (await removeIfExists(join(workDir, sub, `${slug}${ext}`))) removed++;
    }
  }
  return removed;
}

async function removeOutputFiles(outputDir: string, dir: string, slug: string, extensions: string[]): Promise<number> {
  let removed = 0;
  for (const ext of extensions) {
    if (await removeIfExists(join(outputDir, dir, `${slug}${ext}`))) removed++;
  }
  return removed;
}

interface CleanupEntry {
  relativePath: string;
  slug: string | undefined;
}

async function cleanupBySlug(ctx: BuildContext, entries: Iterable<CleanupEntry>): Promise<number> {
  const cacheBase = join(ctx.cwd, '.iteraciones');
  let removed = 0;
  for (const { relativePath, slug } of entries) {
    const dir = dirname(relativePath);
    const outSlug = htmlSlugFor(relativePath, slug);
    removed += await removeCachedArtifacts(cacheBase, dir, outSlug);
    removed += await removeOutputFiles(ctx.outputDir, dir, outSlug, ALL_OUTPUT_EXTENSIONS);
  }
  await pruneEmptyDirs(ctx.outputDir);
  return removed;
}

export async function cleanupRemovedFormats(ctx: BuildContext, allDocs: BuildDocument[], removedFormats: string[]): Promise<number> {
  if (removedFormats.length === 0) return 0;

  const extensions = removedFormats.flatMap((fmt) => FORMAT_OUTPUT_EXTENSIONS[fmt as FormatKey] ?? []);
  let removed = 0;
  for (const doc of allDocs) {
    removed += await removeOutputFiles(ctx.outputDir, dirname(doc.relativePath), htmlSlugFor(doc.relativePath, doc.slug), extensions);
  }

  if (removedFormats.includes('html')) {
    await rm(join(ctx.outputDir, 'css'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'fonts'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'logo.svg'), { force: true }).catch(() => {});
  }
  return removed;
}

export async function cleanupCoverImages(
  ctx: BuildContext,
  allDocs: BuildDocument[],
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<number> {
  let removed = 0;
  for (const doc of allDocs) {
    const rawFm = discoveryIndex.get(doc.relativePath)?.fm ?? {};
    if (resolveBooleanField(rawFm, siteConfig.format?.pdf, siteConfig, 'coverImage') === true) continue;
    const png = join(ctx.outputDir, dirname(doc.relativePath), `${htmlSlugFor(doc.relativePath, doc.slug)}.png`);
    if (await removeIfExists(png)) removed++;
  }
  return removed;
}

export async function cleanupDeletedFiles(
  ctx: BuildContext,
  changedPaths: Set<string>,
  allDocs: BuildDocument[],
  deletedEntries: Map<string, DiscoveryEntry>,
): Promise<number> {
  const allDocPathsSet = new Set(allDocs.map((d) => d.relativePath));
  const deletedMdPaths = [...changedPaths].filter((p) => p.endsWith('.md') && !allDocPathsSet.has(p));
  if (deletedMdPaths.length === 0) return 0;

  const entries = deletedMdPaths.map((relPath) => ({
    relativePath: relPath,
    slug: deletedEntries.get(relPath)?.slug ?? basename(relPath, '.md'),
  }));
  return cleanupBySlug(ctx, entries);
}

export async function cleanupSlugChanges(ctx: BuildContext, slugChangedEntries: Map<string, string>): Promise<number> {
  if (slugChangedEntries.size === 0) return 0;

  const entries = [...slugChangedEntries].map(([relativePath, oldSlug]) => ({ relativePath, slug: oldSlug }));
  return cleanupBySlug(ctx, entries);
}
