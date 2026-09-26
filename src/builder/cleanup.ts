import { readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve, sep } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import type { FormatKey } from '../config/site-config.js';
import { resolveBooleanField } from '../lib/frontmatter-fields.js';
import { htmlSlugFor } from './discover.js';
import { LATEXMK_AUX_EXTENSIONS } from './export/runner.js';
import {
  ALL_OUTPUT_EXTENSIONS,
  ASSETS_CSS_FILE,
  ASSETS_FONTS_DIR,
  ASSETS_LOGO_FILE,
  FORMAT_OUTPUT_EXTENSIONS,
  LEGACY_ASSETS_IMG_DIR,
} from './output-layout.js';
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

/**
 * #2450 — el css, las fuentes y el logo solo los usa el HTML: con el layout
 * nuevo viven en `assets/`, y los de la raíz son residuo del anterior. Se retira
 * el directorio, no el fichero, para no dejar `assets/css/` vacío.
 */
async function removeHtmlAssets(outputDir: string): Promise<void> {
  for (const rel of [dirname(ASSETS_CSS_FILE), ASSETS_FONTS_DIR, ASSETS_LOGO_FILE, 'css', 'fonts', 'logo.svg']) {
    await rm(join(outputDir, rel), { recursive: true, force: true }).catch(() => {});
  }
}

export async function cleanupRemovedFormats(ctx: BuildContext, allDocs: BuildDocument[], removedFormats: string[]): Promise<number> {
  if (removedFormats.length === 0) return 0;

  const extensions = removedFormats.flatMap((fmt) => FORMAT_OUTPUT_EXTENSIONS[fmt as FormatKey] ?? []);
  let removed = 0;
  const root = resolve(ctx.outputDir);
  for (const doc of allDocs) {
    removed += await removeOutputFiles(ctx.outputDir, dirname(doc.relativePath), htmlSlugFor(doc.relativePath, doc.slug), extensions);
    // #2452: los miembros ya no tienen copia con el nombre de su fuente, pero
    // una salida heredada de antes del cambio puede seguir ahí: con el
    // markdown desactivado se retira también.
    if (removedFormats.includes('markdown') && doc.frontmatter.type === 'collection') {
      for (const f of doc.frontmatter.files ?? []) {
        const dest = resolve(root, normalize(f));
        if (dest.startsWith(`${root}${sep}`) && (await removeIfExists(dest))) removed++;
      }
    }
  }

  if (removedFormats.includes('html')) await removeHtmlAssets(ctx.outputDir);
  return removed;
}

/**
 * #2450 — ¿la salida quedó con el layout anterior de assets (los directorios
 * `css`, `fonts`, el `logo.svg` en la raíz, o un `assets/img` por nivel)? Los
 * documentos que este build no recompile siguen apuntando ahí, así que el build
 * se reconstruye entero antes de escribir nada: un único rebuild tras actualizar.
 */
export async function hasLegacyAssetLayout(outputDir: string): Promise<boolean> {
  // Sin salida todavía no hay nada que migrar (y scan lanzaría ENOENT)
  if (
    !(await stat(outputDir)
      .then((s) => s.isDirectory())
      .catch(() => false))
  )
    return false;
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
  // #2452: la limpieza es solo para un `.md` cuya fuente desapareció
  // (deletedEntries): los miembros de una collection ya están en allDocs, y un
  // miembro modificado no debe confundirse con un borrado.
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
