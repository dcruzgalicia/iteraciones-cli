import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { EpubFormatConfig, HtmlFormatConfig, MarkdownFormatConfig, PdfFormatConfig } from '../../config/site-config.js';
import { PandocError } from '../../lib/errors.js';
import { mapWithConcurrency } from '../../lib/run.js';
import { computeSlug } from '../discover.js';
import { discoverBibFiles } from '../latex-preamble.js';
import { type BuildDocument, isExportSkipped } from '../types.js';
import { assembleExportDocument } from './assemble.js';

import type { ExportDocument, ExportMetadata } from './types.js';

interface ExportFormatOptions {
  pdf?: PdfFormatConfig;
  epub?: EpubFormatConfig;
  markdown?: MarkdownFormatConfig;
  html?: HtmlFormatConfig;
}

interface ExportRunOptions {
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

export async function runExportDocuments(exportableDocs: BuildDocument[], options: ExportRunOptions): Promise<void> {
  const { config, outputDir, cwd, lang, concurrency } = options;

  const hasPdf = config.pdf?.generate === true;

  if (exportableDocs.length === 0) return;

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

  // Closure que genera los formatos para un ExportDocument ya ensamblado.
  async function generateFormats(exportDoc: ExportDocument, outputBase: string, biberCacheDir?: string): Promise<void> {
    const tasks: Array<Promise<void>> = [];

    if (config.markdown?.generate) {
      tasks.push(convertToMarkdown(exportDoc, `${outputBase}.md`));
    }

    if (config.epub?.generate) {
      const epubHtml = exportDoc.htmlBody;
      if (epubHtml) {
        tasks.push(convertToEpub(epubHtml, `${outputBase}.epub`, exportDoc));
      }
    }

    if (config.pdf?.generate) {
      const outputPath = `${outputBase}.pdf`;
      tasks.push(
        (async () => {
          await acquireLatex();
          try {
            await convertToPdf(exportDoc, outputPath, cwd, config.pdf, biberCacheDir);
          } finally {
            releaseLatex();
          }
          options.onExportProgress?.(exportDoc.relativePath);
        })(),
      );
    }

    if (tasks.length > 0) {
      const settled = await Promise.allSettled(tasks);
      const rejected = settled.find((r) => r.status === 'rejected');
      if (rejected) throw rejected.reason;
    }
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
  await mapWithConcurrency(exportableDocs, pdfConcurrency, async (doc): Promise<void> => {
    if (isExportSkipped(doc.frontmatter)) {
      return;
    }

    const exportDoc = assembleExportDocument(doc, lang, cwd, globalBibliography, undefined, config.pdf);
    if (!exportDoc) return;

    const outputBase = exportOutputBase(exportDoc, outputDir);
    const biberCacheDir = biberCacheForDoc.get(doc.relativePath);
    await generateFormats(exportDoc, outputBase, biberCacheDir);
  });
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
async function convertToEpub(htmlBody: string, outputPath: string, doc?: ExportDocument): Promise<void> {
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

  if (proc.stderr == null || typeof proc.stderr === 'number') {
    throw new PandocError('No se pudo leer stderr de pandoc', doc?.filePath ?? '', '');
  }

  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    throw new PandocError(`pandoc falló al generar EPUB`, doc?.filePath ?? '', stderr);
  }
}

/**
 * Exporta un documento a Markdown via pandoc (latex → markdown).
 */
async function convertToMarkdown(doc: ExportDocument, outputPath: string): Promise<void> {
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
async function convertToPdf(
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
