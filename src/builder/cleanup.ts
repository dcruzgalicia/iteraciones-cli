import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { mapWithConcurrency } from '../lib/run.js';
import { htmlSlugFor } from './discover.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

/** Extensiones de salida estándar por documento en dist/. */
const OUTPUT_EXTENSIONS = ['.html', '.tex', '.pdf', '.epub', '.md'];

const FORMAT_EXT_MAP: Record<string, string> = {
  latex: '.tex',
  pdf: '.pdf',
  html: '.html',
  epub: '.epub',
  markdown: '.md',
};

/** Elimina los artefactos cacheados de un documento (`.iteraciones/`). */
async function removeCachedArtifacts(cacheBase: string, dir: string, slug: string): Promise<void> {
  await rm(join(cacheBase, 'ast', dir, `${slug}.json`), { force: true }).catch(() => {});
  for (const sub of ['pdf', 'html']) {
    for (const ext of ['.tex', '.html', '.epub']) {
      await rm(join(cacheBase, 'formats', sub, dir, `${slug}${ext}`), { force: true }).catch(() => {});
    }
  }
}

/** Elimina archivos de salida de un documento en dist/ (por extensiones). */
async function removeOutputFiles(outputDir: string, dir: string, slug: string, extensions: string[]): Promise<void> {
  for (const ext of extensions) {
    await rm(join(outputDir, dir, `${slug}${ext}`), { force: true }).catch(() => {});
  }
}

/** Limpia caché y salida de documentos identificados por (directorio, slug). */
async function cleanupBySlug(ctx: BuildContext, entries: Iterable<{ dir: string; slug: string }>): Promise<void> {
  const cacheBase = join(ctx.cwd, '.iteraciones');
  for (const { dir, slug } of entries) {
    await removeCachedArtifacts(cacheBase, dir, slug);
    await removeOutputFiles(ctx.outputDir, dir, slug, OUTPUT_EXTENSIONS);
  }
}

export async function cleanupRemovedFormats(ctx: BuildContext, allDocs: BuildDocument[], removedFormats: string[]): Promise<void> {
  if (removedFormats.length === 0) return;

  const extensions = removedFormats.map((fmt) => FORMAT_EXT_MAP[fmt]).filter((ext): ext is string => ext !== undefined);
  for (const doc of allDocs) {
    await removeOutputFiles(ctx.outputDir, dirname(doc.relativePath), doc.slug ?? basename(doc.relativePath, '.md'), extensions);
  }

  if (removedFormats.includes('html')) {
    await rm(join(ctx.outputDir, 'css'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'fonts'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'logo.svg'), { force: true }).catch(() => {});
  }
}

export async function cleanupDeletedFiles(
  ctx: BuildContext,
  changedPaths: Set<string>,
  allDocs: BuildDocument[],
  deletedEntries: Map<string, DiscoveryEntry>,
): Promise<void> {
  const allDocPathsSet = new Set(allDocs.map((d) => d.relativePath));
  const deletedMdPaths = [...changedPaths].filter((p) => p.endsWith('.md') && !allDocPathsSet.has(p));
  if (deletedMdPaths.length === 0) return;

  const entries = deletedMdPaths.map((relPath) => ({
    dir: dirname(relPath),
    slug: deletedEntries.get(relPath)?.slug ?? basename(relPath, '.md'),
  }));
  await cleanupBySlug(ctx, entries);
  // Un index.md eliminado deja su index.html huérfano en dist/
  for (const relPath of deletedMdPaths) {
    if (basename(relPath) === 'index.md') {
      await rm(join(ctx.outputDir, dirname(relPath), 'index.html'), { force: true }).catch(() => {});
    }
  }
}

export async function cleanupSlugChanges(ctx: BuildContext, slugChangedEntries: Map<string, string>): Promise<void> {
  if (slugChangedEntries.size === 0) return;

  const entries = [...slugChangedEntries].map(([relPath, oldSlug]) => ({ dir: dirname(relPath), slug: oldSlug }));
  await cleanupBySlug(ctx, entries);
}

export async function copyToDist(
  ctx: BuildContext,
  allDocs: BuildDocument[],
  formatsDir: string,
  active: { latexOn: boolean; pdfOn: boolean; htmlOn: boolean; epubOn: boolean; mdOn: boolean },
): Promise<void> {
  const copySpec: Array<[boolean, string, string]> = [
    [active.latexOn, 'pdf', 'tex'],
    [active.pdfOn, 'pdf', 'pdf'],
    [active.htmlOn, 'html', 'html'],
    [active.epubOn, 'html', 'epub'],
    [active.mdOn, 'markdown', 'md'],
  ];
  const copies: Array<{ srcPath: string; dstPath: string }> = [];
  for (const doc of allDocs) {
    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    const htmlSlug = htmlSlugFor(doc.relativePath, slug);
    const dir = dirname(doc.relativePath);
    for (const [isActive, format, ext] of copySpec) {
      if (!isActive) continue;
      const outSlug = format === 'html' ? htmlSlug : slug;
      copies.push({ srcPath: join(formatsDir, format, dir, `${outSlug}.${ext}`), dstPath: join(ctx.outputDir, dir, `${outSlug}.${ext}`) });
    }
  }
  await mapWithConcurrency(copies, 20, async ({ srcPath, dstPath }) => {
    await mkdir(dirname(dstPath), { recursive: true });
    await rename(srcPath, dstPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return;
      throw err;
    });
  });
}

export function buildFormatsList(active: { latexOn: boolean; pdfOn: boolean; htmlOn: boolean; epubOn: boolean; mdOn: boolean }): string[] {
  const formats: string[] = [];
  if (active.latexOn) formats.push('latex');
  if (active.pdfOn) formats.push('pdf');
  if (active.htmlOn) formats.push('html');
  if (active.epubOn) formats.push('epub');
  if (active.mdOn) formats.push('markdown');
  return formats;
}
