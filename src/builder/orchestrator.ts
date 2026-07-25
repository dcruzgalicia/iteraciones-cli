import { mkdir, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ProgressTracker } from '../cli/progress.js';
import { loadSiteConfig } from '../config/config-loader.js';

import { buildAssets, generateLatexPreamble, renderHtmlPage } from './build-utils.js';
import { type BuildReport, buildDocsFromIndex, discover } from './discover.js';
import { runExportDocuments } from './export/runner.js';
import { renderLatex } from './render.js';
import { type BuildContext, type BuildDocument, isExportSkipped } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  concurrency?: number;
  noCache?: boolean;
  noTailwind?: boolean;
  noExport?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

async function setupBuildEnvironment(cwd: string, options: BuildOptions): Promise<BuildContext> {
  const siteConfig = await loadSiteConfig(cwd);

  const defaultOutputDir = join(cwd, 'dist', 'files');
  const ctx: BuildContext = {
    siteConfig,
    cwd,
    outputDir: options.outputDir ?? defaultOutputDir,
    cssPath: '',
    concurrency: options.concurrency ?? Math.max(1, cpus().length - 1),
  };

  if (options.noCache) {
    await rm(ctx.outputDir, { recursive: true, force: true });
    await rm(join(cwd, '.iteraciones'), { recursive: true, force: true });
  }

  return ctx;
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
  const generateHtml = ctx.siteConfig.format?.html?.generate === true;

  progress.startPhase('discovery');
  const [{ relativePaths, changedPaths: discoveredChanges, discoveryIndex, deletedEntries }, cssPath] = await Promise.all([
    discover(cwd, { noCache: options.noCache }),
    generateHtml ? buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, { noTailwind: options.noTailwind }) : Promise.resolve(''),
  ]);
  ctx.cssPath = cssPath;
  const allDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);

  if (options.verbose) {
    for (const doc of allDocs) {
      progress.reportFile({ relativePath: doc.relativePath, phase: 'discovery' });
    }
  }
  progress.completePhase(allDocs.length);

  // Assign slugs from discoveryIndex
  for (const doc of allDocs) {
    const entry = discoveryIndex.get(doc.relativePath);
    doc.slug = entry?.slug ?? basename(doc.relativePath, '.md');
  }

  const GLOBAL_CHANGE_PATTERNS = [/\.ya?ml$/, /\.html$/];
  const changedPaths = discoveredChanges;
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

  // ── FASE 2+3: markdown → latex → html (combinada) ──
  progress.startPhase('render', pipelineDocs.length);
  const renderResults = await renderLatex(pipelineDocs, ctx.concurrency, cwd, ctx.siteConfig.disabledTranspilers);
  for (const doc of allDocs) {
    const result = renderResults.get(doc.relativePath);
    if (result) {
      doc.processedBody = result.processedBody;
      doc.htmlFragment = result.htmlFragment;
      doc.slug = result.slug;
    }
  }
  progress.completePhase();

  // Cleanup deleted files from tex/ and formats/
  {
    const allDocPathsSet = new Set(allDocs.map((d) => d.relativePath));
    const deletedMdPaths = [...changedPaths].filter((p) => p.endsWith('.md') && !allDocPathsSet.has(p));
    const cacheBase = join(ctx.cwd, '.iteraciones');
    for (const relPath of deletedMdPaths) {
      const dir = dirname(relPath);
      const entry = deletedEntries.get(relPath);
      const slug = entry?.slug ?? basename(relPath, '.md');
      await rm(join(cacheBase, 'tex', dir, `${slug}.tex`), { force: true }).catch(() => {});
      await rm(join(cacheBase, 'html', dir, `${slug}.html`), { force: true }).catch(() => {});
      await rm(join(cacheBase, 'formats', 'pdf', dir, `${slug}.tex`), { force: true }).catch(() => {});
      await rm(join(cacheBase, 'formats', 'html', dir, `${slug}.html`), { force: true }).catch(() => {});
      await rm(join(cacheBase, 'formats', 'html', dir, `${slug}.epub`), { force: true }).catch(() => {});
      for (const ext of ['.html', '.tex', '.pdf', '.epub', '.md']) {
        await rm(join(ctx.outputDir, dir, `${slug}${ext}`), { force: true }).catch(() => {});
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
  const exportBase = { cwd, lang: ctx.siteConfig.lang, concurrency: ctx.concurrency };

  const countExportDocs = (docs: BuildDocument[]): number => {
    let count = 0;
    for (const d of docs) {
      if (isExportSkipped(d.frontmatter)) continue;
      count++;
    }
    return count;
  };

  // ── FASE 4: 4 ramas en paralelo ──
  await Promise.all([
    // Markdown
    (async () => {
      if (!formatCfg?.markdown?.generate || noExport) return;
      const mdTotal = countExportDocs(pipelineDocs);
      progress.startPhase('markdown', mdTotal);
      await runExportDocuments(pipelineDocs, {
        ...exportBase,
        outputDir: join(formatsDir, 'markdown'),
        config: { markdown: formatCfg?.markdown },
        onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, phase: 'markdown' }),
      });
      progress.completePhase(undefined, 'markdown');
    })(),

    // HTML (template completo)
    (async () => {
      if (!formatCfg?.html?.generate || noExport) return;
      const siteConfig = ctx.siteConfig;
      const htmlConfig = siteConfig.format?.html;
      const hasCss = !options.noTailwind && ctx.cssPath;
      progress.startPhase('html', pipelineDocs.length);
      for (const doc of pipelineDocs) {
        const slug = doc.slug ?? basename(doc.relativePath, '.md');
        const dir = dirname(doc.relativePath);
        const src = join(ctx.cwd, '.iteraciones', 'html', dir, `${slug}.html`);
        const dst = join(formatsDir, 'html', dir, `${slug}.html`);
        try {
          const fragment = await Bun.file(src).text();
          // Leer SVG del logo para incrustarlo inline (permite currentColor)
          let logoInline: string | undefined;
          try {
            const logoPath = join(ctx.outputDir, 'logo.svg');
            logoInline = await Bun.file(logoPath).text();
          } catch {}

          const html = await renderHtmlPage(fragment, {
            title: doc.frontmatter.title || slug,
            siteTitle: siteConfig.title ?? '',
            tagline: siteConfig.tagline,
            lang: siteConfig.lang ?? 'es',
            logoInline,
            baseUrl: siteConfig.baseUrl,
            theme: htmlConfig?.theme,
            accent: htmlConfig?.accent,
            css: hasCss ? 'css/styles.css' : undefined,
            author: doc.frontmatter.author,
            description: typeof doc.frontmatter.abstract === 'string' ? doc.frontmatter.abstract : undefined,
          });
          await mkdir(dirname(dst), { recursive: true });
          await Bun.write(dst, html);
        } catch {
          process.stderr.write(`[orchestrator] error al generar HTML para ${doc.relativePath}
`);
        }
      }
      progress.completePhase(undefined, 'html');
    })(),

    // EPUB
    (async () => {
      if (!formatCfg?.epub?.generate || noExport) return;
      const epubTotal = countExportDocs(pipelineDocs);
      progress.startPhase('epub', epubTotal);
      await runExportDocuments(pipelineDocs, {
        ...exportBase,
        outputDir: join(formatsDir, 'html'),
        config: { epub: formatCfg?.epub },
        onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, phase: 'epub' }),
      });
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
        const pdfTotal = countExportDocs(pipelineDocs);
        progress.startPhase('pdf', pdfTotal);
        await runExportDocuments(pipelineDocs, {
          ...exportBase,
          outputDir: join(formatsDir, 'pdf'),
          config: { pdf: formatCfg?.pdf },
          onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, phase: 'pdf' }),
        });
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
}
