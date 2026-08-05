import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import type { EpubFormatConfig, HtmlFormatConfig, MarkdownFormatConfig, PdfFormatConfig, SiteConfig } from '../../config/site-config.js';
import { PandocError } from '../../lib/errors.js';
import { logWarning } from '../../lib/logger.js';
import { runPandoc } from '../../lib/pandoc-runner.js';
import { mapWithConcurrency } from '../../lib/run.js';
import { computeSlug } from '../discover.js';
import { resolveUserLuaFilters } from '../render.js';
import { readAstFromCache, resolveBibOptions } from '../state.js';
import type { BuildDocument } from '../types.js';
import { assembleExportDocument } from './assemble.js';

import type { ExportDocument } from './types.js';

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
  siteConfig: SiteConfig;
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

  // Con PDF activo, el limite de concurrencia es CPU − 1: las invocaciones
  // de latexmk son pesadas y compiten por el mismo pool de workers.
  const maxSlots = hasPdf ? Math.max(1, cpus().length - 1) : 0;

  // Auto-descubrir archivos .bib en el proyecto
  const globalBibliography: string | undefined = resolveBibOptions(cwd).bibOptions?.bibliography;
  const userFilters = await resolveUserLuaFilters(cwd, options.siteConfig);
  const needsAst = config.epub?.generate === true || config.markdown?.generate === true;
  const pdfConcurrency = hasPdf ? maxSlots : concurrency;

  // Pre-crear directorios de cache de biber (uno por slot de concurrencia).
  const biberCacheForDoc = new Map<string, string>();
  if (hasPdf && maxSlots > 0) {
    const biberBase = join(cwd, '.iteraciones', 'biber');
    await Promise.all(Array.from({ length: maxSlots }, (_, i) => mkdir(join(biberBase, `cache-${i}`), { recursive: true })));
    exportableDocs.forEach((doc, i) => {
      biberCacheForDoc.set(doc.relativePath, join(biberBase, `cache-${i % maxSlots}`));
    });
  }

  const ctx: ExportDocContext = {
    config,
    outputDir,
    cwd,
    lang,
    globalBibliography,
    needsAst,
    userFilters,
    biberCacheForDoc,
    onExportProgress: options.onExportProgress,
  };
  await mapWithConcurrency(exportableDocs, pdfConcurrency, (doc) => exportOneDoc(doc, ctx));
}

/** Contexto compartido por todas las exportaciones de un build. */
interface ExportDocContext {
  config: ExportFormatOptions;
  outputDir: string;
  cwd: string;
  lang: string;
  globalBibliography?: string;
  needsAst: boolean;
  userFilters: string[];
  biberCacheForDoc: Map<string, string>;
  onExportProgress?: (relativePath: string) => void;
}

/**
 * Exporta todos los formatos activos de un documento individual.
 * epub/markdown se generan desde el AST canónico (json → epub3/markdown),
 * PDF compila el .tex con latexmk.
 */
async function exportOneDoc(doc: BuildDocument, ctx: ExportDocContext): Promise<void> {
  const exportDoc = assembleExportDocument(doc, ctx.lang, ctx.globalBibliography, undefined, ctx.config.pdf);

  const ast = ctx.needsAst ? await readAstFromCache(ctx.cwd, doc) : null;
  if (ctx.needsAst && !ast) {
    logWarning(`sin AST en caché para ${doc.relativePath}; se omite la exportación epub/markdown`, 'export');
  }

  const outputBase = exportOutputBase(exportDoc, ctx.outputDir);
  const biberCacheDir = ctx.biberCacheForDoc.get(doc.relativePath);
  await generateFormats(ctx, exportDoc, outputBase, ast, biberCacheDir);
}

/** Genera los formatos para un ExportDocument ya ensamblado. */
async function generateFormats(
  ctx: ExportDocContext,
  exportDoc: ExportDocument,
  outputBase: string,
  ast: Record<string, unknown> | null,
  biberCacheDir?: string,
): Promise<void> {
  const { config, cwd, userFilters, onExportProgress } = ctx;
  const tasks: Array<Promise<void>> = [];

  if (config.markdown?.generate && ast) {
    tasks.push(convertToMarkdown(ast, `${outputBase}.md`, exportDoc, userFilters).then(() => onExportProgress?.(exportDoc.relativePath)));
  }

  if (config.epub?.generate && ast) {
    tasks.push(convertToEpub(ast, `${outputBase}.epub`, exportDoc, userFilters).then(() => onExportProgress?.(exportDoc.relativePath)));
  }

  if (config.pdf?.generate) {
    const outputPath = `${outputBase}.pdf`;
    tasks.push(convertToPdf(exportDoc, outputPath, cwd, biberCacheDir).then(() => onExportProgress?.(exportDoc.relativePath)));
  }

  if (tasks.length > 0) {
    const settled = await Promise.allSettled(tasks);
    const rejected = settled.find((r) => r.status === 'rejected');
    if (rejected) throw rejected.reason;
  }
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

  // Bibliografía global (auto-descubierta de archivos .bib del proyecto)
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

  return `---\n${stringify(header, { defaultKeyType: 'PLAIN', defaultStringType: 'QUOTE_DOUBLE' })}---\n`;
}

/**
 * Convierte el AST canónico a EPUB3 usando pandoc (sin intermediario HTML).
 */
async function convertToEpub(ast: Record<string, unknown>, outputPath: string, doc: ExportDocument, userFilters: string[]): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const extraArgs: string[] = [];
  for (const f of userFilters) extraArgs.push('--lua-filter', f);
  if (doc.metadata.bibliography) {
    extraArgs.push('--citeproc');
  }

  await runPandoc({ input: JSON.stringify(ast), sourcePath: doc.filePath, from: 'json', to: 'epub3', outputPath, extraArgs });
}

/**
 * Exporta un documento a Markdown via pandoc (json → markdown, sin round-trip por LaTeX).
 */
async function convertToMarkdown(ast: Record<string, unknown>, outputPath: string, doc: ExportDocument, userFilters: string[]): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const extraArgs: string[] = [];
  for (const f of userFilters) extraArgs.push('--lua-filter', f);
  const stdout = await runPandoc({ input: JSON.stringify(ast), sourcePath: doc.filePath, from: 'json', to: 'markdown', extraArgs });
  const yamlHeader = buildYamlHeader(doc);
  await Bun.write(outputPath, yamlHeader + stdout);
}

/**
 * Convierte un ExportDocument a PDF compilando el .tex con latexmk.
 */
async function convertToPdf(doc: ExportDocument, outputPath: string, cwd?: string, biberCacheDir?: string): Promise<void> {
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
    const log = `${stdout}\n${stderr}`;
    const m = log.match(/^! .*$/m);
    throw new PandocError(`latexmk falló al generar PDF para ${doc.filePath}: ${m ? m[0] : `exit ${exitCode}`}`, doc.filePath, stderr);
  }
}
