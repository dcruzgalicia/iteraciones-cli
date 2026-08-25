import { readdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { htmlSlugFor } from './discover.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

/** Extensiones de salida estática por documento en dist/ (incluye la portada PDF). */
const OUTPUT_EXTENSIONS = ['.html', '.tex', '.pdf', '.epub', '.md', '.png'];

/** Auxiliares de latexmk que se acumulan en .iteraciones/tmp/pdf/ (por slot de concurrencia). */
import { LATEXMK_AUX_EXTENSIONS } from './export/runner.js';

const FORMAT_EXT_MAP: Record<string, string[]> = {
  latex: ['.tex'],
  // .png = imagen de portada opcional (format.pdf.cover-image)
  pdf: ['.pdf', '.png'],
  html: ['.html'],
  epub: ['.epub'],
  markdown: ['.md'],
};

/**
 * Slug de salida efectivo (#2012): ÚNICA fuente usada tanto para GENERAR las
 * rutas en dist/ (pipeline) como para LIMPIARLAS. Desajustarse aquí deja
 * huérfanos — p. ej. index.md produce index.* pero su slug de título es otro.
 */
function outSlugFor(relativePath: string, slug: string | undefined): string {
  return htmlSlugFor(relativePath, slug);
}

/** Elimina un archivo si existe; devuelve si existía (para el informe). */
async function removeIfExists(path: string): Promise<boolean> {
  if (!(await Bun.file(path).exists())) return false;
  await rm(path, { force: true }).catch(() => {});
  return true;
}

/** Elimina directorios vacíos bajo outputDir (bottom-up, nunca la raíz). */
async function pruneEmptyDirs(outputDir: string): Promise<void> {
  const dirs: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await readdir(join(outputDir, rel), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const childRel = rel === '.' ? entry.name : `${rel}/${entry.name}`;
      dirs.push(childRel);
      await walk(childRel);
    }
  };
  await walk('.');
  // Bottom-up: los padres se vacían tras eliminar los hijos
  for (const dir of dirs.reverse()) {
    const remaining = await readdir(join(outputDir, dir)).catch(() => ['x']);
    if (remaining.length === 0) await rm(join(outputDir, dir), { force: true }).catch(() => {});
  }
}

/** Elimina los artefactos cacheados de un documento (`.iteraciones/`). */
async function removeCachedArtifacts(cacheBase: string, dir: string, slug: string): Promise<number> {
  let removed = 0;
  // Área de trabajo del PDF: .tex (sin latexOn) y auxiliares de latexmk
  // (el .log solo se referencia en errores de builds vivos).
  if (await removeIfExists(join(cacheBase, 'tmp', 'pdf', dir, `${slug}.tex`))) removed++;
  // Auxiliares de latexmk en el directorio directo y en cada slot de
  // concurrencia (se acumulaban para siempre al eliminar un documento o cambiar
  // su slug; el .log solo se referencia en errores de builds vivos).
  const workDir = join(cacheBase, 'tmp', 'pdf', dir);
  const targets: string[] = [''];
  try {
    const entries = await readdir(workDir, { withFileTypes: true });
    for (const e of entries) if (e.isDirectory() && e.name.startsWith('slot-')) targets.push(e.name);
  } catch {
    // El directorio de trabajo puede no existir todavía (nunca se compiló PDF).
  }
  for (const sub of targets) {
    for (const ext of LATEXMK_AUX_EXTENSIONS) {
      if (await removeIfExists(join(workDir, sub, `${slug}${ext}`))) removed++;
    }
  }
  return removed;
}

/** Elimina archivos de salida de un documento en dist/ (por extensiones). */
async function removeOutputFiles(outputDir: string, dir: string, slug: string, extensions: string[]): Promise<number> {
  let removed = 0;
  for (const ext of extensions) {
    if (await removeIfExists(join(outputDir, dir, `${slug}${ext}`))) removed++;
  }
  return removed;
}

interface CleanupEntry {
  relativePath: string;
  /** Slug PREVIO a limpiar (el viejo en cambios de slug; el del documento borrado). */
  slug: string | undefined;
}

/** Limpia caché y salida de documentos identificados por su ruta y slug previo. */
async function cleanupBySlug(ctx: BuildContext, entries: Iterable<CleanupEntry>): Promise<number> {
  const cacheBase = join(ctx.cwd, '.iteraciones');
  let removed = 0;
  for (const { relativePath, slug } of entries) {
    const dir = dirname(relativePath);
    const outSlug = outSlugFor(relativePath, slug);
    removed += await removeCachedArtifacts(cacheBase, dir, outSlug);
    removed += await removeOutputFiles(ctx.outputDir, dir, outSlug, OUTPUT_EXTENSIONS);
  }
  await pruneEmptyDirs(ctx.outputDir);
  return removed;
}

export async function cleanupRemovedFormats(ctx: BuildContext, allDocs: BuildDocument[], removedFormats: string[]): Promise<number> {
  if (removedFormats.length === 0) return 0;

  const extensions = removedFormats.flatMap((fmt) => FORMAT_EXT_MAP[fmt] ?? []);
  let removed = 0;
  for (const doc of allDocs) {
    removed += await removeOutputFiles(ctx.outputDir, dirname(doc.relativePath), outSlugFor(doc.relativePath, doc.slug), extensions);
  }

  if (removedFormats.includes('html')) {
    await rm(join(ctx.outputDir, 'css'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'fonts'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'logo.svg'), { force: true }).catch(() => {});
  }
  return removed;
}

export async function cleanupCoverImages(ctx: BuildContext, allDocs: BuildDocument[]): Promise<number> {
  let removed = 0;
  for (const doc of allDocs) {
    const png = join(ctx.outputDir, dirname(doc.relativePath), `${outSlugFor(doc.relativePath, doc.slug)}.png`);
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
  // htmlSlugFor dentro de cleanupBySlug cubre el caso index.md sin bloque especial
  return cleanupBySlug(ctx, entries);
}

export async function cleanupSlugChanges(ctx: BuildContext, slugChangedEntries: Map<string, string>): Promise<number> {
  if (slugChangedEntries.size === 0) return 0;

  const entries = [...slugChangedEntries].map(([relativePath, oldSlug]) => ({ relativePath, slug: oldSlug }));
  return cleanupBySlug(ctx, entries);
}
