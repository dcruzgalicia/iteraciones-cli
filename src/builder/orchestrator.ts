import { mkdir, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { ProgressTracker, type RenderFileReport } from '../output/progress.js';

import { buildAssets } from './assets.js';
import { runExportDocuments } from './export/runner.js';
import { EXPORTABLE_TYPES, type ExportResult } from './export/types.js';
import { generateHtmlFragment, generateLatexPreamble } from './format-generator.js';
import { type BuildReport, buildDocsFromIndex, type DiscoverResult, discover } from './pipeline/discover.js';
import { renderLatex } from './pipeline/render.js';
import type { BuildContext, BuildDocument, DocumentType } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  cssPath?: string;
  concurrency?: number;
  noCache?: boolean;
  noTailwind?: boolean;
  noExport?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  changedPaths?: Set<string>;
}

async function setupBuildEnvironment(cwd: string, options: BuildOptions): Promise<BuildContext> {
  const siteConfig = await loadSiteConfig(cwd);

  const defaultOutputDir = join(cwd, 'dist', 'files');
  const ctx: BuildContext = {
    siteConfig,
    cwd,
    outputDir: options.outputDir ?? defaultOutputDir,
    cssPath: options.cssPath ?? '',
    concurrency: options.concurrency ?? Math.max(1, cpus().length - 1),
  };

  if (options.noCache) {
    await rm(ctx.outputDir, { recursive: true, force: true });
    await rm(join(cwd, '.iteraciones'), { recursive: true, force: true });
  }

  return ctx;
}

async function runDiscovery(cwd: string, _ctx: BuildContext, noCache?: boolean): Promise<DiscoverResult> {
  return discover(cwd, { noCache });
}

export async function build(cwd: string, options: BuildOptions = {}): Promise<void> {
  if (options.dryRun) {
    const { relativePaths, discoveryIndex } = await discover(cwd, { noCache: true });
    const sourceDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);
    process.stdout.write(`[dry-run] Se procesar\u00edan ${sourceDocs.length} documentos\n`);
    return;
  }

  const progress = new ProgressTracker({ verbose: options.verbose ?? false });
  const log = (msg: string) => progress.log(msg);

  if (options.noCache) {
    progress.showCleanup();
  }

  const ctx = await setupBuildEnvironment(cwd, options);
  try {
    const generateHtml = ctx.siteConfig.format?.html?.generate === true;

    progress.startPhase('discovery');
    const [{ relativePaths, changedPaths: discoveredChanges, discoveryIndex, deletedEntries }, cssPath] = await Promise.all([
      runDiscovery(cwd, ctx, options.noCache),
      generateHtml ? buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, { noTailwind: options.noTailwind }) : Promise.resolve(''),
    ]);
    ctx.cssPath = cssPath;
    const sourceDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);
    const allDocs = sourceDocs as BuildDocument[];

    if (options.verbose) {
      for (const doc of allDocs) {
        progress.reportFile({ relativePath: doc.relativePath, durationMs: 0, cacheHit: false, phase: 'discovery' });
      }
    }
    progress.completePhase(allDocs.length);

    // Assign slugs from discoveryIndex
    for (const doc of allDocs) {
      const entry = discoveryIndex.get(doc.relativePath);
      doc.slug = entry?.slug ?? basename(doc.relativePath, '.md');
    }

    const GLOBAL_CHANGE_PATTERNS = [/\.ya?ml$/, /\.html$/];
    const changedPaths = options.changedPaths ?? discoveredChanges;
    const noChanges = changedPaths.size === 0;

    if (noChanges) {
      log('Ningun documento modificado — sin cambios');
      progress.finish(0, allDocs.length, []);
      return;
    }

    const isGlobalChange = [...changedPaths].some((p) => GLOBAL_CHANGE_PATTERNS.some((re) => re.test(p)));
    const pipelineDocs = isGlobalChange ? allDocs : allDocs.filter((d) => changedPaths.has(d.relativePath));
    const totalDocCount = allDocs.length;

    if (pipelineDocs.length === 0) {
      log('Ningun documento modificado — sin cambios');
      progress.finish(0, totalDocCount, []);
      return;
    }

    // ── FASE 2: markdown → latex (tex/)
    if (pipelineDocs.length > 0) {
      progress.startPhase('render', pipelineDocs.length);
      const docsWithMd = await renderLatex(pipelineDocs, ctx.concurrency ?? 4, cwd, ctx.siteConfig.disabledTranspilers);
      const mdMap = new Map<string, BuildDocument>(docsWithMd.map((d) => [d.relativePath, d]));
      for (const doc of allDocs) {
        const processed = mdMap.get(doc.relativePath);
        if (processed && processed.processedBody) {
          doc.processedBody = processed.processedBody;
        }
      }
    }

    // Write .tex body to disk
    for (const doc of pipelineDocs) {
      if (!doc.processedBody || !doc.slug) continue;
      const texDir = join(ctx.cwd, '.iteraciones', 'tex', dirname(doc.relativePath));
      await mkdir(texDir, { recursive: true });
      await Bun.write(join(texDir, `${doc.slug}.tex`), doc.processedBody);
    }
    if (pipelineDocs.length > 0) {
      progress.completePhase();
    }

    // Cleanup deleted files
    {
      const allDocPathsSet = new Set(allDocs.map((d) => d.relativePath));
      const deletedMdPaths = [...changedPaths].filter((p) => p.endsWith('.md') && !allDocPathsSet.has(p));
      if (deletedMdPaths.length > 0) {
        const cacheBase = join(ctx.cwd, '.iteraciones');
        for (const relPath of deletedMdPaths) {
          const dir = dirname(relPath);
          const entry = deletedEntries.get(relPath);
          const slug = entry?.slug ?? basename(relPath, '.md');
          await rm(join(cacheBase, 'tex', dir, `${slug}.tex`), { force: true }).catch(() => {});
          for (const ext of ['.html', '.tex', '.pdf', '.epub', '.md']) {
            await rm(join(ctx.outputDir, dir, `${slug}${ext}`), { force: true }).catch(() => {});
          }
        }
      }
    }

    const formatCfg = ctx.siteConfig.format;
    const pdfOn = formatCfg?.pdf?.generate === true || (!!formatCfg?.html?.thumbnails && formatCfg?.pdf !== undefined);
    const latexOn = formatCfg?.latex?.generate === true;
    const htmlOn = formatCfg?.html?.generate === true;
    const epubOn = formatCfg?.epub?.generate === true;
    const mdOn = formatCfg?.markdown?.generate === true;

    // Preparar datos para FASE 4
    const noExport = options.noExport === true;
    const formatsDir = join(cwd, '.iteraciones', 'formats');
    const exportBase = { cwd, lang: ctx.siteConfig.lang, concurrency: ctx.concurrency ?? 4 };
    const exportResults: ExportResult[] = [];

    const baseRenderedMap = new Map<DocumentType, BuildDocument[]>();
    baseRenderedMap.set('file', pipelineDocs);

    const countExportDocs = (map: Map<DocumentType, BuildDocument[]>, type: DocumentType): number => {
      const docs = map.get(type) ?? [];
      let count = 0;
      for (const d of docs) {
        const raw = d.frontmatter['export'];
        const skipped = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>)['skip'] === true;
        if (skipped) continue;
        count++;
      }
      return count;
    };

    // ── FASE 3: html fragment (antes del Promise.all) ──
    {
      const recentMdPaths = [...changedPaths].filter((p) => p.endsWith('.md') && !deletedEntries.has(p));
      const deletedMdPaths = [...deletedEntries.keys()].filter((p) => p.endsWith('.md'));
      const diff: BuildReport = {
        startedAt: Date.now(),
        recentFiles: recentMdPaths,
        deletedFiles: deletedMdPaths,
      };
      if (htmlOn || epubOn) {
        await generateHtmlFragment(cwd, ctx.siteConfig, discoveryIndex, diff);
      }
      // Cleanup deleted files from formats/
      for (const relPath of deletedMdPaths) {
        const entry = discoveryIndex.get(relPath);
        const slug = entry?.slug ?? basename(relPath, '.md');
        const dir = dirname(relPath);
        await rm(join(cwd, '.iteraciones', 'formats', 'pdf', dir, `${slug}.tex`), { force: true }).catch(() => {});
        await rm(join(cwd, '.iteraciones', 'formats', 'html', dir, `${slug}.html`), { force: true }).catch(() => {});
        await rm(join(cwd, '.iteraciones', 'formats', 'html', dir, `${slug}.epub`), { force: true }).catch(() => {});
      }
    }

    // Leer htmlFragment del disco para EPUB
    if (epubOn) {
      for (const doc of pipelineDocs) {
        if (doc.htmlFragment !== undefined) continue;
        const slug = doc.slug ?? basename(doc.relativePath, '.md');
        const htmlPath = join(ctx.cwd, '.iteraciones', 'html', dirname(doc.relativePath), `${slug}.html`);
        try {
          doc.htmlFragment = await Bun.file(htmlPath).text();
        } catch {}
      }
    }

    // ── FASE 4: 4 ramas en paralelo ──
    await Promise.all([
      // Markdown
      (async () => {
        if (!formatCfg?.markdown?.generate || noExport) return;
        let mdTotal = 0;
        for (const type of EXPORTABLE_TYPES) {
          const docs = (baseRenderedMap.get(type) ?? []).filter((d) => d.kind !== 'block');
          for (const d of docs) {
            const raw = d.frontmatter['export'];
            const skipped = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>)['skip'] === true;
            if (skipped) continue;
            mdTotal++;
          }
        }
        progress.startPhase('markdown', mdTotal);
        const mdResults = await runExportDocuments(baseRenderedMap, {
          ...exportBase,
          outputDir: join(formatsDir, 'markdown'),
          config: { markdown: formatCfg?.markdown },
          onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, durationMs: 0, cacheHit: false, phase: 'markdown' }),
        });
        for (const r of mdResults) {
          if (r.markdownPath) r.markdownPath = r.markdownPath.replace(join(formatsDir, 'markdown'), ctx.outputDir);
        }
        exportResults.push(...mdResults);
        progress.completePhase(undefined, 'markdown');
      })(),

      // HTML (copia fragmento)
      (async () => {
        if (!formatCfg?.html?.generate || noExport) return;
        progress.startPhase('html', pipelineDocs.length);
        for (const doc of pipelineDocs) {
          const slug = doc.slug ?? basename(doc.relativePath, '.md');
          const dir = dirname(doc.relativePath);
          const src = join(ctx.cwd, '.iteraciones', 'html', dir, `${slug}.html`);
          const dst = join(formatsDir, 'html', dir, `${slug}.html`);
          try {
            await mkdir(dirname(dst), { recursive: true });
            await Bun.write(dst, Bun.file(src));
          } catch {}
        }
        progress.completePhase(undefined, 'html');
      })(),

      // EPUB
      (async () => {
        if (!formatCfg?.epub?.generate || noExport) return;
        let epubTotal = 0;
        for (const type of EXPORTABLE_TYPES) epubTotal += countExportDocs(baseRenderedMap, type);
        progress.startPhase('epub', epubTotal);
        const epubResults = await runExportDocuments(baseRenderedMap, {
          ...exportBase,
          outputDir: join(formatsDir, 'html'),
          config: { epub: formatCfg?.epub },
          onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, durationMs: 0, cacheHit: false, phase: 'epub' }),
        });
        for (const r of epubResults) {
          if (r.epubPath) r.epubPath = r.epubPath.replace(join(formatsDir, 'html'), ctx.outputDir);
          if (r.epubFullPath) r.epubFullPath = r.epubFullPath.replace(join(formatsDir, 'html'), ctx.outputDir);
        }
        exportResults.push(...epubResults);
        progress.completePhase(undefined, 'epub');
      })(),

      // LaTeX → PDF (secuencial dentro de la misma rama)
      (async () => {
        if (!pdfOn && !latexOn) return;
        const diff: BuildReport = {
          startedAt: Date.now(),
          recentFiles: [...changedPaths].filter((p) => p.endsWith('.md') && !deletedEntries.has(p)),
          deletedFiles: [...deletedEntries.keys()].filter((p) => p.endsWith('.md')),
        };
        progress.startPhase('latex');
        await generateLatexPreamble(cwd, ctx.siteConfig, discoveryIndex, diff);
        progress.completePhase(undefined, 'latex');

        if (pdfOn && !noExport) {
          let pdfTotal = 0;
          for (const type of EXPORTABLE_TYPES) pdfTotal += countExportDocs(baseRenderedMap, type);
          progress.startPhase('pdf', pdfTotal);
          const pdfResults = await runExportDocuments(baseRenderedMap, {
            ...exportBase,
            outputDir: join(formatsDir, 'pdf'),
            config: { pdf: formatCfg?.pdf },
            onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, durationMs: 0, cacheHit: false, phase: 'pdf' }),
          });
          for (const r of pdfResults) {
            if (r.pdfPath) r.pdfPath = r.pdfPath.replace(join(formatsDir, 'pdf'), ctx.outputDir);
            if (r.pdfFullPath) r.pdfFullPath = r.pdfFullPath.replace(join(formatsDir, 'pdf'), ctx.outputDir);
            if (r.coverPath) r.coverPath = r.coverPath.replace(join(formatsDir, 'pdf'), ctx.outputDir);
          }
          exportResults.push(...pdfResults);
          progress.completePhase(undefined, 'pdf');
        }
      })(),
    ]);

    // ── FASE 5: copiar de formats/ a dist/ ──
    {
      const copySpec: Array<[boolean, string, string]> = [
        [latexOn, 'pdf', 'tex'],
        [pdfOn, 'pdf', 'pdf'],
        [htmlOn, 'html', 'html'],
        [epubOn, 'html', 'epub'],
        [mdOn, 'markdown', 'md'],
      ];
      for (const doc of allDocs) {
        const slug = doc.slug ?? basename(doc.relativePath, '.md');
        const dir = dirname(doc.relativePath);
        for (const [active, format, ext] of copySpec) {
          if (!active) continue;
          const srcPath = join(formatsDir, format, dir, `${slug}.${ext}`);
          const dstPath = join(ctx.outputDir, dir, `${slug}.${ext}`);
          const exists = await Bun.file(srcPath).exists();
          if (exists) {
            await mkdir(dirname(dstPath), { recursive: true });
            await Bun.write(dstPath, Bun.file(srcPath));
          }
        }
      }
    }

    const totalDocs = htmlOn || pdfOn || epubOn || mdOn || latexOn ? totalDocCount : 0;
    const processedCount = pipelineDocs.length;
    const cachedCount = totalDocs - processedCount;
    const generatedFormats: string[] = [];
    if (latexOn) generatedFormats.push('latex');
    if (pdfOn) generatedFormats.push('pdf');
    if (htmlOn) generatedFormats.push('html');
    if (epubOn) generatedFormats.push('epub');
    if (mdOn) generatedFormats.push('markdown');
    progress.finish(processedCount, cachedCount, generatedFormats);
  } finally {
  }
}
