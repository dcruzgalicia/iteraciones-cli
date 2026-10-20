import { exists, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import type { FormatKey } from '../config/site-config.js';
import { resolveBooleanField } from '../lib/frontmatter-fields.js';
import { isDir, isInside } from '../lib/paths.js';
import { htmlSlugFor } from './discover.js';
import { LATEXMK_AUX_EXTENSIONS } from './export.js';
import {
  ALL_OUTPUT_EXTENSIONS,
  ASSETS_CSS_FILE,
  ASSETS_FONTS_DIR,
  ASSETS_LOGO_FILE,
  FORMAT_OUTPUT_EXTENSIONS,
  LEGACY_ASSETS_IMG_DIR,
  PDF_WORK_DIR,
} from './output-layout.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

export async function pruneEmptyDirs(outputDir: string): Promise<void> {
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
  await rm(join(cacheBase, PDF_WORK_DIR, dir, `${slug}.tex`), { force: true });
  removed++;
  const workDir = join(cacheBase, PDF_WORK_DIR, dir);
  const targets: string[] = [''];
  try {
    const entries = await readdir(workDir, { withFileTypes: true });
    for (const e of entries) if (e.isDirectory() && e.name.startsWith('slot-')) targets.push(e.name);
  } catch {}
  for (const sub of targets) {
    for (const ext of LATEXMK_AUX_EXTENSIONS) {
      await rm(join(workDir, sub, `${slug}${ext}`), { force: true });
      removed++;
    }
  }
  return removed;
}

async function removeOutputFiles(outputDir: string, dir: string, slug: string, extensions: string[]): Promise<number> {
  let removed = 0;
  for (const ext of extensions) {
    await rm(join(outputDir, dir, `${slug}${ext}`), { force: true });
    removed++;
  }
  return removed;
}

interface CleanupEntry {
  relativePath: string;
  slug: string | undefined;
}

/**
 * El documento que escribe un HTML con este nombre en este directorio, si
 * alguno. Lo usan las páginas paginadas de las colecciones, que se nombran
 * `<slug>-N.html` y podrían pisar el archivo de otro documento.
 */
export function htmlOwner(discoveryIndex: Map<string, DiscoveryEntry>, dir: string, nombre: string): string | undefined {
  for (const [ruta, entry] of discoveryIndex) {
    if (dirname(ruta) !== dir) continue;
    if (htmlSlugFor(ruta, entry.slug) === nombre) return ruta;
  }
  return undefined;
}

/**
 * Borra las páginas que sobraron de una colección que se encogió. No toca las
 * que pertenezcan a otro documento.
 */
export async function removeExtraHtmlPages(
  outputDir: string,
  dir: string,
  slug: string,
  keep: number,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<number> {
  const base = join(outputDir, dir);
  const pattern = new RegExp(`^${RegExp.escape(slug)}-\\d+\\.html$`);
  let removed = 0;
  for (const file of await readdir(base).catch(() => [])) {
    if (!pattern.test(file)) continue;
    const n = Number.parseInt(file.slice(slug.length + 1, -'.html'.length), 10);
    if (!Number.isFinite(n) || n <= keep) continue;
    if (htmlOwner(discoveryIndex, dir, file.slice(0, -'.html'.length)) !== undefined) continue;
    const path = join(base, file);
    if (!(await exists(path))) continue;
    await rm(path, { force: true });
    removed++;
  }
  return removed;
}

async function cleanupBySlug(ctx: BuildContext, entries: Iterable<CleanupEntry>): Promise<number> {
  const cacheBase = join(ctx.cwd, '.iteraciones');
  let removed = 0;
  for (const { relativePath, slug } of entries) {
    const dir = dirname(relativePath);
    const outSlug = htmlSlugFor(relativePath, slug);
    removed += await removeCachedArtifacts(cacheBase, dir, outSlug);
    removed += await removeOutputFiles(ctx.outputDir, dir, outSlug, ALL_OUTPUT_EXTENSIONS);
    removed += await removeExtraHtmlPages(ctx.outputDir, dir, outSlug, 0, new Map());
  }
  await pruneEmptyDirs(ctx.outputDir);
  return removed;
}

async function removeHtmlAssets(outputDir: string): Promise<void> {
  for (const rel of [dirname(ASSETS_CSS_FILE), ASSETS_FONTS_DIR, ASSETS_LOGO_FILE, 'css', 'fonts', 'logo.svg']) {
    await rm(join(outputDir, rel), { recursive: true, force: true }).catch(() => {});
  }
}

async function removeMarkdownMembers(doc: BuildDocument, root: string): Promise<number> {
  let removed = 0;
  for (const f of doc.frontmatter.files ?? []) {
    const dest = resolve(root, normalize(f));
    if (!isInside(root, dest)) continue;
    await rm(dest, { force: true });
    removed++;
  }
  return removed;
}

export async function cleanupRemovedFormats(ctx: BuildContext, allDocs: BuildDocument[], removedFormats: string[]): Promise<number> {
  if (removedFormats.length === 0) return 0;

  const extensions = removedFormats.flatMap((fmt) => FORMAT_OUTPUT_EXTENSIONS[fmt as FormatKey] ?? []);
  const sinHtml = !removedFormats.includes('html');
  const sinMarkdown = !removedFormats.includes('markdown');
  let removed = 0;
  const root = resolve(ctx.outputDir);
  for (const doc of allDocs) {
    const dir = dirname(doc.relativePath);
    const outSlug = htmlSlugFor(doc.relativePath, doc.slug);
    removed += await removeOutputFiles(ctx.outputDir, dir, outSlug, extensions);
    if (!sinHtml) {
      removed += await removeExtraHtmlPages(ctx.outputDir, dir, outSlug, 0, new Map());
    }

    if (!sinMarkdown && doc.frontmatter.type === 'collection') {
      removed += await removeMarkdownMembers(doc, root);
    }
  }

  if (!sinHtml) await removeHtmlAssets(ctx.outputDir);
  return removed;
}

export async function hasLegacyAssetLayout(outputDir: string): Promise<boolean> {
  if (!(await isDir(outputDir))) return false;
  for (const rel of ['css', 'fonts', 'logo.svg']) {
    if (
      await stat(join(outputDir, rel))
        .then(() => true)
        .catch(() => false)
    ) {
      return true;
    }
  }
  for await (const entry of new Bun.Glob(`**/${LEGACY_ASSETS_IMG_DIR}`).scan({ cwd: outputDir, onlyFiles: false })) {
    if (entry !== '') return true;
  }
  return false;
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
    await rm(png, { force: true });
    removed++;
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

  const deletedMdPaths = [...changedPaths].filter((p) => p.endsWith('.md') && !allDocPathsSet.has(p) && deletedEntries.has(p));
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
