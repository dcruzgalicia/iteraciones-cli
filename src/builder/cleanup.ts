import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

/** Extensiones de salida estándar por documento en dist/ (incluye la portada PDF). */
const OUTPUT_EXTENSIONS = ['.html', '.tex', '.pdf', '.epub', '.md', '.png'];

/** Auxiliares de latexmk que se acumulan en .iteraciones/tmp/pdf/. */
export const LATEXMK_AUX_EXTENSIONS = ['.aux', '.bbl', '.bcf', '.blg', '.fls', '.run.xml', '.fdb_latexmk', '.out', '.toc', '.log'];

const FORMAT_EXT_MAP: Record<string, string[]> = {
  latex: ['.tex'],
  // .png = imagen de portada opcional (format.pdf.cover-image)
  pdf: ['.pdf', '.png'],
  html: ['.html'],
  epub: ['.epub'],
  markdown: ['.md'],
};

/** Elimina los artefactos cacheados de un documento (`.iteraciones/`). */
async function removeCachedArtifacts(cacheBase: string, dir: string, slug: string): Promise<void> {
  // Área de trabajo del PDF: .tex (sin latexOn) y auxiliares de latexmk
  // (el .log solo se referencia en errores de builds vivos).
  await rm(join(cacheBase, 'tmp', 'pdf', dir, `${slug}.tex`), { force: true }).catch(() => {});
  // Auxiliares de latexmk (se acumulaban para siempre al eliminar un documento
  // o cambiar su slug; el .log solo se referencia en errores de builds vivos).
  for (const ext of LATEXMK_AUX_EXTENSIONS) {
    await rm(join(cacheBase, 'tmp', 'pdf', dir, `${slug}${ext}`), { force: true }).catch(() => {});
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

  const extensions = removedFormats.flatMap((fmt) => FORMAT_EXT_MAP[fmt] ?? []);
  for (const doc of allDocs) {
    await removeOutputFiles(ctx.outputDir, dirname(doc.relativePath), doc.slug ?? basename(doc.relativePath, '.md'), extensions);
  }

  if (removedFormats.includes('html')) {
    await rm(join(ctx.outputDir, 'css'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'fonts'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'logo.svg'), { force: true }).catch(() => {});
  }
}

export async function cleanupCoverImages(ctx: BuildContext, allDocs: BuildDocument[]): Promise<void> {
  for (const doc of allDocs) {
    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    await rm(join(ctx.outputDir, dirname(doc.relativePath), `${slug}.png`), { force: true }).catch(() => {});
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
  // Un index.md eliminado deja sus salidas index.* huérfanas en dist/
  for (const relPath of deletedMdPaths) {
    if (basename(relPath) === 'index.md') {
      const targetDir = join(ctx.outputDir, dirname(relPath));
      for (const ext of OUTPUT_EXTENSIONS) {
        await rm(join(targetDir, `index${ext}`), { force: true }).catch(() => {});
      }
    }
  }
}

export async function cleanupSlugChanges(ctx: BuildContext, slugChangedEntries: Map<string, string>): Promise<void> {
  if (slugChangedEntries.size === 0) return;

  const entries = [...slugChangedEntries].map(([relPath, oldSlug]) => ({ dir: dirname(relPath), slug: oldSlug }));
  await cleanupBySlug(ctx, entries);
}
