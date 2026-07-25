import { existsSync, rmSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';

import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { EpubFormatConfig, HtmlFormatConfig, MarkdownFormatConfig, PdfFormatConfig, ThumbnailMode } from '../../config/site-config.js';
import { THUMBNAIL_SIZES } from '../../config/site-config.js';
import { mapWithConcurrency } from '../../lib/concurrency.js';
import { discoverBibFiles } from '../latex-preamble.js';
import { computeSlug } from '../slug.js';
import type { BuildDocument } from '../types.js';
import { assembleExportDocument } from './assemble.js';
import { convertToEpub, convertToMarkdown, convertToPdf } from './pandoc.js';
import type { ExportDocument, ExportMetadata, ExportResult } from './types.js';

/**
 * Tipos de thumbnail reconocidos:
 * - true: genera un solo JPG de 1200px (`<outputBase>.jpg`)
 * - 'responsive': genera sm(320), md(640), lg(1200), xl(2400)
 */
type ThumbnailRequest = { mode: true; coverPath: string } | { mode: 'responsive' };

const THUMBNAIL_DEFAULT_WIDTH = 1200;

function resolveThumbnailRequest(mode: ThumbnailMode, outputBase: string): ThumbnailRequest | null {
  if (!mode) return null;
  if (mode === true) return { mode: true, coverPath: `${outputBase}.jpg` };
  if (mode === 'responsive') return { mode: 'responsive' };
  return null;
}

async function generateCoverImage(pdfPath: string, outputBase: string, request: ThumbnailRequest): Promise<string | undefined> {
  try {
    if (request.mode === true) {
      const coverPath = request.coverPath;
      const [coverStat, pdfStat] = await Promise.all([stat(coverPath).catch(() => null), stat(pdfPath)]);
      if (coverStat && coverStat.mtimeMs >= pdfStat.mtimeMs) return coverPath;
      const proc = Bun.spawn(['pdftoppm', '-r', '150', '-jpeg', '-singlefile', '-scale-to', String(THUMBNAIL_DEFAULT_WIDTH), pdfPath, outputBase], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) return undefined;
      const exists = await Bun.file(coverPath).exists();
      return exists ? coverPath : undefined;
    }

    const pdfStat = await stat(pdfPath);
    let coverPath: string | undefined;

    for (const [name, width] of Object.entries(THUMBNAIL_SIZES)) {
      const sizePath = `${outputBase}.${name}.jpg`;
      try {
        const existing = await stat(sizePath).catch(() => null);
        if (existing && existing.mtimeMs >= pdfStat.mtimeMs) {
          if (width === THUMBNAIL_DEFAULT_WIDTH) coverPath = sizePath;
          continue;
        }
      } catch {}

      const proc = Bun.spawn(['pdftoppm', '-r', '150', '-jpeg', '-singlefile', '-scale-to', String(width), pdfPath, `${outputBase}.${name}`], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const exitCode = await proc.exited;
      if (
        exitCode === 0 &&
        (await Bun.file(sizePath)
          .exists()
          .catch(() => false))
      ) {
        if (width === THUMBNAIL_DEFAULT_WIDTH) coverPath = sizePath;
      }
    }

    return coverPath;
  } catch {
    return undefined;
  }
}

export interface ExportFormatOptions {
  pdf?: PdfFormatConfig;
  epub?: EpubFormatConfig;
  markdown?: MarkdownFormatConfig;
  html?: HtmlFormatConfig;
}

export interface ExportRunOptions {
  config: ExportFormatOptions;
  outputDir: string;
  cwd: string;
  lang: string;
  concurrency: number;
  onExportProgress?: (relativePath: string) => void;
}

function exportOutputBase(exportDoc: ExportDocument, outputDir: string): string {
  const dir = dirname(exportDoc.relativePath);
  const dirPart = dir === '.' ? '' : dir;

  if (exportDoc.slug) {
    return join(outputDir, dirPart, exportDoc.slug);
  }

  const computed = computeSlug(exportDoc.metadata);
  if (computed && exportDoc.metadata.title !== 'Sin título') {
    return join(outputDir, dirPart, computed);
  }

  return join(outputDir, exportDoc.relativePath.replace(/\.md$/, ''));
}

export async function runExportDocuments(exportableDocs: BuildDocument[], options: ExportRunOptions): Promise<ExportResult[]> {
  const { config, outputDir, cwd, lang, concurrency } = options;

  const hasPdf = config.pdf?.generate === true || !!config.html?.thumbnails;

  if (exportableDocs.length === 0) return [];

  // Semaforo que limita las instancias de pdflatex concurrentes.
  const maxSlots = hasPdf ? Math.max(1, cpus().length - 1) : 0;
  let latexSlots = maxSlots;
  const latexQueue: Array<() => void> = [];
  const acquireLatex = (): Promise<void> =>
    new Promise<void>((res) => {
      if (latexSlots > 0) {
        latexSlots--;
        res();
      } else {
        latexQueue.push(res);
      }
    });
  const releaseLatex = (): void => {
    const next = latexQueue.shift();
    if (next) {
      next();
    } else {
      latexSlots++;
    }
  };

  // Auto-descubrir archivos .bib en el proyecto
  const allBib = discoverBibFiles(cwd);
  const globalBibliography: string | undefined = allBib[0];
  let globalCsl: string | undefined;

  let _pdfDone = 0;
  const _pdfTotal = hasPdf ? exportableDocs.length : 0;

  // Closure que genera los formatos para un ExportDocument ya ensamblado.
  async function generateFormats(
    exportDoc: ExportDocument,
    outputBase: string,
    biberCacheDir?: string,
  ): Promise<Array<PromiseSettledResult<{ epub?: string; pdf?: string; md?: string }>>> {
    const tasks: Array<Promise<{ epub?: string; pdf?: string; md?: string }>> = [];

    if (config.markdown?.generate) {
      const outputPath = `${outputBase}.md`;
      tasks.push(
        (async () => {
          await convertToMarkdown(exportDoc, outputPath);
          return { md: outputPath };
        })(),
      );
    }

    if (config.epub?.generate) {
      const outputPath = `${outputBase}.epub`;
      tasks.push(
        (async () => {
          const epubHtml = exportDoc.htmlBody;
          if (!epubHtml) return {};
          await convertToEpub(epubHtml, outputPath, exportDoc);
          return { epub: outputPath };
        })(),
      );
    }

    const genPdf = config.pdf?.generate || (config.html?.thumbnails && config.pdf);
    if (genPdf && config.pdf) {
      const outputPath = `${outputBase}.pdf`;
      tasks.push(
        (async () => {
          await acquireLatex();
          try {
            await convertToPdf(exportDoc, outputPath, cwd, config.pdf, biberCacheDir);
          } finally {
            releaseLatex();
          }
          if (!existsSync(outputPath)) {
            return {};
          }
          _pdfDone++;
          options.onExportProgress?.(exportDoc.relativePath);
          return { pdf: outputPath };
        })(),
      );
    }

    return Promise.allSettled(tasks);
  }

  // Pre-crear directorios de cache de biber.
  const biberCacheForDoc = new Map<string, string>();
  if (hasPdf && maxSlots > 0) {
    const biberBase = join(cwd, '.iteraciones', 'biber');
    await Promise.all(Array.from({ length: maxSlots }, (_, i) => mkdir(join(biberBase, `cache-${i}`), { recursive: true })));
    exportableDocs.forEach((doc, i) => {
      biberCacheForDoc.set(doc.relativePath, join(biberBase, `cache-${i % maxSlots}`));
    });
  }

  const pdfConcurrency = hasPdf ? maxSlots : concurrency;
  const results = await mapWithConcurrency(exportableDocs, pdfConcurrency, async (doc): Promise<ExportResult | null> => {
    const rawExportField = doc.frontmatter.export;
    if (
      typeof rawExportField === 'object' &&
      rawExportField !== null &&
      !Array.isArray(rawExportField) &&
      Object.getPrototypeOf(rawExportField) === Object.prototype &&
      (rawExportField as Record<string, unknown>).skip === true
    ) {
      return null;
    }

    const rawExportDoc = assembleExportDocument(doc, lang, cwd, globalBibliography, globalCsl, config.pdf);
    if (!rawExportDoc) return null;

    const exportDoc = rawExportDoc;
    const outputBase = exportOutputBase(exportDoc, outputDir);
    const biberCacheDir = biberCacheForDoc.get(doc.relativePath);
    const formatResults = await generateFormats(exportDoc, outputBase, biberCacheDir);

    const result: ExportResult = {
      filePath: exportDoc.filePath,
      relativePath: exportDoc.relativePath,
    };
    let firstError: unknown;
    for (const fr of formatResults) {
      if (fr.status === 'fulfilled') {
        if (fr.value.epub) result.epubPath = fr.value.epub;
        if (fr.value.pdf) result.pdfPath = fr.value.pdf;
        if (fr.value.md) result.markdownPath = fr.value.md;
      } else if (!firstError) {
        firstError = fr.reason;
      }
    }
    if (firstError) throw firstError;
    if (result.pdfPath && config.html?.thumbnails) {
      const request = resolveThumbnailRequest(config.html.thumbnails, outputBase);
      if (request) {
        const coverPath = await generateCoverImage(result.pdfPath, outputBase, request);
        if (coverPath) result.coverPath = coverPath;
      }
      if (!config.pdf?.generate) {
        rmSync(result.pdfPath);
      }
    }
    return result;
  });

  return results.filter((r): r is ExportResult => r !== null);
}
