import { existsSync, rmSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';

import { cpus } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { EpubFormatConfig, HtmlFormatConfig, MarkdownFormatConfig, PdfFormatConfig, ThumbnailMode } from '../../config/site-config.js';
import { THUMBNAIL_SIZES } from '../../config/site-config.js';
import { mapWithConcurrency } from '../../lib/concurrency.js';
import { PandocError } from '../../lib/errors.js';
import { discoverBibFiles } from '../latex-preamble.js';
import { computeSlug } from '../slug.js';
import type { BuildDocument } from '../types.js';
import { assembleExportDocument } from './assemble.js';

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
/**
 * Construye el bloque YAML de metadatos que Pandoc inyectará en el documento.
 * Solo usada para exportación a Markdown.
 */
function buildYamlHeader(doc: ExportDocument): string {
  const { metadata } = doc;
  const lines: string[] = ['---'];

  lines.push(`title: ${yamlString(metadata.title)}`);

  if (metadata.author.length > 0) {
    if (metadata.author.length === 1) {
      lines.push(`author: ${yamlString(metadata.author[0] ?? '')}`);
    } else {
      lines.push('author:');
      for (const a of metadata.author) {
        lines.push(`  - ${yamlString(a)}`);
      }
    }
  }

  if (metadata.date) lines.push(`date: ${yamlString(metadata.date)}`);
  lines.push(`lang: ${metadata.lang}`);
  lines.push(`documentclass: ${metadata.documentclass}`);
  if (metadata.toc) lines.push('toc: true');
  if (metadata.tocDepth !== undefined && metadata.tocDepth > 0) {
    lines.push(`toc-depth: ${metadata.tocDepth}`);
  }

  // Metadatos editoriales opcionales
  if (metadata.isbn) lines.push(`isbn: ${yamlString(metadata.isbn)}`);
  if (metadata.publisher) lines.push(`publisher: ${yamlString(metadata.publisher)}`);
  if (metadata.description) lines.push(`description: ${yamlString(metadata.description)}`);
  if (metadata.rights) lines.push(`rights: ${yamlString(metadata.rights)}`);
  if (metadata.cover) lines.push(`cover-image: ${yamlString(metadata.cover)}`);
  if (metadata.bibliography) {
    lines.push(`bibliography: ${yamlString(metadata.bibliography)}`);
  }
  if (metadata.csl) {
    if (existsSync(metadata.csl)) {
      lines.push(`csl: ${yamlString(metadata.csl)}`);
    } else {
      process.stderr.write(`\r\x1b[K⚠ archivo CSL no encontrado: "${metadata.csl}"\n`);
    }
  }

  if (metadata.dictum && metadata.dictum.length > 0) {
    lines.push('dictum:');
    for (const entry of metadata.dictum) {
      if (entry.author) {
        lines.push(`  - text: ${yamlString(entry.text)}`);
        lines.push(`    author: ${yamlString(entry.author)}`);
      } else {
        lines.push(`  - text: ${yamlString(entry.text)}`);
      }
    }
  }
  if (metadata.abstract) lines.push(`abstract: ${yamlString(metadata.abstract)}`);
  if (metadata.keywords && metadata.keywords.length > 0) {
    lines.push('keywords:');
    for (const kw of metadata.keywords) {
      lines.push(`  - ${yamlString(kw)}`);
    }
  }

  lines.push('---', '');
  return lines.join('\n');
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * Convierte contenido HTML a EPUB3 usando pandoc.
 */
export async function convertToEpub(htmlBody: string, outputPath: string, doc?: ExportDocument): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const args = ['pandoc', '--from', 'html', '--to', 'epub3', '--output', outputPath];

  if (doc?.metadata.cover) {
    args.push('--epub-cover-image', doc.metadata.cover);
  }

  if (doc?.metadata.bibliography) {
    args.push('--citeproc');
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, doc?.filePath ?? '', '');
  }

  if (proc.stdin == null || typeof proc.stdin === 'number') {
    throw new PandocError('No se pudo escribir stdin de pandoc', doc?.filePath ?? '', '');
  }

  proc.stdin.write(htmlBody);
  proc.stdin.end();

  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr as ReadableStream<Uint8Array>).text(), proc.exited]);

  if (exitCode !== 0) {
    throw new PandocError(`pandoc falló al generar EPUB`, doc?.filePath ?? '', stderr);
  }
}

/**
 * Exporta un documento a Markdown via pandoc (latex → markdown).
 */
export async function convertToMarkdown(doc: ExportDocument, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const args = ['pandoc', '--from', 'latex', '--to', 'markdown'];
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, doc.filePath, '');
  }
  if (proc.stdin == null || typeof proc.stdin === 'number') {
    throw new PandocError('No se pudo escribir stdin de pandoc', doc.filePath, '');
  }
  if (proc.stdout == null || typeof proc.stdout === 'number') {
    throw new PandocError('No se pudo leer stdout de pandoc', doc.filePath, '');
  }
  if (proc.stderr == null || typeof proc.stderr === 'number') {
    throw new PandocError('No se pudo leer stderr de pandoc', doc.filePath, '');
  }
  proc.stdin.write(doc.body);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) {
    throw new PandocError(`pandoc falló al convertir a markdown ${doc.filePath}`, doc.filePath, stderr);
  }
  const yamlHeader = buildYamlHeader(doc);
  await Bun.write(outputPath, yamlHeader + stdout);
}

/**
 * Convierte un ExportDocument a PDF compilando el .tex con latexmk.
 */
export async function convertToPdf(
  doc: ExportDocument,
  outputPath: string,
  cwd?: string,
  pdfFormat?: PdfFormatConfig,
  biberCacheDir?: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  if (!cwd) {
    throw new PandocError('convertToPdf: cwd es requerido para localizar el .tex', doc.filePath, '');
  }

  const slug = doc.slug ?? basename(doc.relativePath, '.md');
  const texRelDir = dirname(doc.relativePath);
  const pdfDir = join(cwd, '.iteraciones', 'formats', 'pdf', texRelDir);
  const fullTexPath = join(pdfDir, `${slug}.tex`);

  if (!(await Bun.file(fullTexPath).exists())) {
    throw new PandocError(`convertToPdf: no se encontro ${fullTexPath}`, doc.filePath, '');
  }

  const biberCache = biberCacheDir ?? join(cwd, '.iteraciones', 'biber', texRelDir, slug);
  await mkdir(biberCache, { recursive: true });
  const proc = Bun.spawn(['latexmk', '-pdf', '-interaction=nonstopmode', `-outdir=${pdfDir}`, `-jobname=${slug}`, fullTexPath], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PAR_GLOBAL_TEMP: biberCache },
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    const log = stdout + '\n' + stderr;
    const m = log.match(/^! .*$/m);
    throw new PandocError(`latexmk falló al generar PDF para ${doc.filePath}: ${m ? m[0] : 'exit ' + exitCode}`, doc.filePath, stderr);
  }
}
