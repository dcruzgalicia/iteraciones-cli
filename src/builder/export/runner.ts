import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import type { EpubFormatConfig, HtmlFormatConfig, MarkdownFormatConfig, PdfFormatConfig } from '../../config/site-config.js';
import { PandocError } from '../../lib/errors.js';
import { logWarning } from '../../lib/logger.js';
import { runPandoc } from '../../lib/pandoc-runner.js';
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
  const header: Record<string, unknown> = { title: metadata.title };

  if (metadata.author.length > 0) {
    header.author = metadata.author.length === 1 ? metadata.author[0] : metadata.author;
  }

  if (metadata.date) header.date = metadata.date;
  header.lang = metadata.lang;
  header.documentclass = metadata.documentclass;
  if (metadata.toc) header.toc = true;
  if (metadata.tocDepth !== undefined && metadata.tocDepth > 0) {
    header['toc-depth'] = metadata.tocDepth;
  }

  // Metadatos editoriales opcionales
  if (metadata.isbn) header.isbn = metadata.isbn;
  if (metadata.publisher) header.publisher = metadata.publisher;
  if (metadata.description) header.description = metadata.description;
  if (metadata.rights) header.rights = metadata.rights;
  if (metadata.cover) header['cover-image'] = metadata.cover;
  if (metadata.bibliography) {
    header.bibliography = metadata.bibliography;
  }
  if (metadata.csl) {
    if (existsSync(metadata.csl)) {
      header.csl = metadata.csl;
    } else {
      logWarning(`archivo CSL no encontrado: "${metadata.csl}"`, 'export');
    }
  }

  if (metadata.abstract) header.abstract = metadata.abstract;
  if (metadata.keywords && metadata.keywords.length > 0) {
    header.keywords = metadata.keywords;
  }

  // Comillas dobles en valores (claves plain) para paridad con el formato
  // anterior y máxima compatibilidad con pandoc
  return `---\n${stringify(header, { defaultKeyType: 'PLAIN', defaultStringType: 'QUOTE_DOUBLE' })}---\n`;
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

  await runPandoc(args, htmlBody, doc?.filePath ?? '');
}

/**
 * Exporta un documento a Markdown via pandoc (latex → markdown).
 */
async function convertToMarkdown(doc: ExportDocument, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const args = ['pandoc', '--from', 'latex', '--to', 'markdown'];
  const { stdout } = await runPandoc(args, doc.body, doc.filePath);
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
