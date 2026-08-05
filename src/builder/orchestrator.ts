import { mkdir, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ProgressTracker } from '../cli/progress.js';
import { loadSiteConfig } from '../config/config-loader.js';
import type { FormatConfig, SiteConfig } from '../config/site-config.js';
import { mapWithConcurrency } from '../lib/run.js';
import { buildAssets } from './build-assets.js';
import { type BuildMetadata, computeBuildMetadata, computeWorkSets, type WorkSets } from './build-planner.js';
import { buildDocsFromIndex, discover, loadBuildState } from './discover.js';
import { runExportDocuments } from './export/runner.js';
import { generateHtmlPages } from './html-generator.js';
import { generateLatexPreamble } from './latex-preamble.js';
import { validateDisabledPreambleFilters } from './preamble-loader.js';
import { renderTexBodyFromCachedAst, renderToCanonicalAst, validateDisabledFilters } from './render.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  concurrency?: number;
  noCache?: boolean;
  noCss?: boolean;
  noExport?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

async function setupBuildEnvironment(cwd: string, siteConfig: SiteConfig, options: BuildOptions): Promise<BuildContext> {
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

  const progress = new ProgressTracker({ renderer: options.verbose ? 'verbose' : 'default' });
  try {
    await runBuild(cwd, options, progress);
  } catch (err) {
    // Resolver las fases pendientes del tracker para que el proceso salga:
    // en TTY el render loop de listr2 mantiene el proceso vivo mientras
    // run() no termine (regresión #1211).
    await progress.fail();
    throw err;
  }
}

async function runBuild(cwd: string, options: BuildOptions, progress: ProgressTracker): Promise<void> {
  const log = (msg: string) => progress.log(msg);

  // Cargar config primero para detectar cambios de formato antes de setupBuildEnvironment
  const siteConfig = await loadSiteConfig(cwd);
  // Validar nombres de filters desactivados (warning sin romper el build)
  validateDisabledFilters(siteConfig.disabledFilters);
  validateDisabledPreambleFilters(siteConfig.disabledPreambleFilters);

  // ── Planificación: hashes de invalidación + formatos (caché content-addressed) ──
  // Con --no-cache no hay estado previo con qué comparar (la caché se borra en
  // setupBuildEnvironment): no cargar prevState evita mensajes de invalidación
  // engañosos y fuerza el reprocesamiento completo.
  const prevState = options.noCache ? null : await loadBuildState(cwd);
  const plan = await computeBuildMetadata(cwd, siteConfig, prevState, options.noCss);

  if (plan.newFormats.length > 0) {
    log(`Nuevos formatos detectados: ${plan.newFormats.join(', ')}. Generando sus salidas para todos los documentos.`);
  }
  if (plan.removedFormats.length > 0) {
    log(`Formatos eliminados: ${plan.removedFormats.join(', ')}. Limpiando archivos de dist.`);
  }
  if (plan.filtersInvalidated) log('Filters modificados — reprocesando todos los documentos');
  if (plan.bibInvalidated) log('Bibliografía modificada — reprocesando todos los documentos');
  if (plan.formatInvalidated.pdf) log('Configuración PDF/LaTeX modificada — regenerando LaTeX/PDF');
  if (plan.formatInvalidated.html) log('Configuración HTML modificada — regenerando páginas HTML');
  if (plan.formatInvalidated.epub) log('Configuración EPUB modificada — regenerando EPUBs');
  if (plan.formatInvalidated.markdown) log('Configuración Markdown modificada — regenerando exports Markdown');

  if (options.noCache) {
    progress.showCleanup();
  }

  const ctx = await setupBuildEnvironment(cwd, siteConfig, options);
  ctx.cssPath = plan.needsCss ? '/css/styles.css' : '';

  progress.startPhase('discovery');
  const {
    relativePaths,
    changedPaths: discoveredChanges,
    discoveryIndex,
    deletedEntries,
    slugChangedEntries,
  } = await discover(cwd, {
    noCache: options.noCache,
    activeFormats: plan.currentFormats,
    prevState,
    meta: { filtersHash: plan.filtersHash, configHashes: plan.configHashes, bibHash: plan.bibHash },
  });
  const allDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);

  if (allDocs.length === 0) {
    process.stdout.write('  No se encontraron documentos Markdown en el proyecto.\n');
    process.stdout.write("  Crea un archivo .md con frontmatter o ejecuta 'iteraciones init'.\n");
    await progress.finish(0, 0, []);
    return;
  }

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

  // Los formatos nuevos no fuerzan re-render: el AST canónico en disco
  // (`.iteraciones/ast/`) permite exportar sus salidas sin re-ejecutar
  // markdown → json (los exportSets ya incluyen todos los docs vía
  // formatInvalidated, que cambia al activarse un formato).

  // ── FASE 6: limpiar de dist/ archivos de formatos eliminados ──
  await cleanupRemovedFormats(ctx, allDocs, plan.removedFormats);

  // ── Planificación: conjuntos de trabajo (caché content-addressed) ──
  const work = computeWorkSets(plan, allDocs, discoveredChanges);

  if (!work.anyWork) {
    log('Ningun documento modificado — sin cambios');
    await progress.finish(0, allDocs.length, []);
    return;
  }

  // Cleanup de archivos eliminados y slugs cambiados
  await cleanupDeletedFiles(ctx, discoveredChanges, allDocs, deletedEntries);
  await cleanupSlugChanges(ctx, slugChangedEntries);

  // Solo hubo eliminaciones o slugs cambiados: el cleanup ya corrió
  if (
    work.renderDocs.length === 0 &&
    work.exportSets.pdf.length === 0 &&
    work.exportSets.html.length === 0 &&
    work.exportSets.epub.length === 0 &&
    work.exportSets.markdown.length === 0
  ) {
    log('Ningun documento modificado — sin cambios');
    await progress.finish(0, allDocs.length, []);
    return;
  }

  // Declarar al tracker las fases que se ejecutarán (TTY: libera discovery para
  // que listr2 evalúe los skips con la información completa)
  await progress.planPhases(work.usedPhases);

  const formatCfg = siteConfig.format;

  // ── FASE 2+3: markdown → AST canónico → salidas por formato activo ──
  const processedPaths = new Set<string>();
  if (work.renderDocs.length > 0 || work.astExportCandidates.length > 0) {
    progress.startPhase('render', work.renderDocs.length + work.astExportCandidates.length);
    if (work.renderDocs.length > 0) {
      const done = await renderToCanonicalAst(work.renderDocs, ctx.concurrency, cwd, ctx.siteConfig, plan.generateLatex);
      for (const p of done) processedPaths.add(p);
    }
    if (work.astExportCandidates.length > 0) {
      const done = await renderTexBodyFromCachedAst(work.astExportCandidates, ctx.concurrency, cwd, ctx.siteConfig, plan.generateLatex);
      // Docs sin AST en disco (primer build, caché limpiada): pipeline completo
      const missingAstDocs = work.astExportCandidates.filter((d) => !done.has(d.relativePath));
      if (missingAstDocs.length > 0) {
        const extra = await renderToCanonicalAst(missingAstDocs, ctx.concurrency, cwd, ctx.siteConfig, plan.generateLatex);
        for (const p of extra) done.add(p);
      }
      for (const p of done) processedPaths.add(p);
    }
    progress.completePhase();
  }

  // Los exports leen sus inputs del caché en disco (AST/tex):
  // no hay hidratación de cuerpos en memoria.

  // ── FASE 4: exportaciones en paralelo ──
  const formatsDir = join(cwd, '.iteraciones', 'formats');
  await runFormatExports(progress, ctx, work, plan, formatCfg, options, formatsDir, discoveryIndex);

  // ── Build assets (css, fonts, logo) antes de copiar a dist/ ──
  if (plan.htmlOn) {
    await buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, { noCss: options.noCss });
  }

  // ── FASE 5: copiar de formats/ a dist/ ──
  await copyToDist(ctx, allDocs, formatsDir, { latexOn: plan.latexOn, pdfOn: plan.pdfOn, htmlOn: plan.htmlOn, epubOn: plan.epubOn, mdOn: plan.mdOn });

  const totalDocs = plan.htmlOn || plan.pdfOn || plan.epubOn || plan.mdOn || plan.latexOn ? allDocs.length : 0;
  const workedPaths = new Set<string>();
  for (const d of work.renderDocs) workedPaths.add(d.relativePath);
  for (const list of [work.exportSets.pdf, work.exportSets.html, work.exportSets.epub, work.exportSets.markdown]) {
    for (const d of list) workedPaths.add(d.relativePath);
  }
  const processedCount = workedPaths.size;
  const cachedCount = totalDocs - processedCount;
  await progress.finish(
    processedCount,
    cachedCount,
    buildFormatsList({ latexOn: plan.latexOn, pdfOn: plan.pdfOn, htmlOn: plan.htmlOn, epubOn: plan.epubOn, mdOn: plan.mdOn }),
  );
}

/**
 * FASE 4: exporta los formatos activos en 4 ramas paralelas.
 * Markdown y EPUB desde el AST, HTML con template, LaTeX → PDF secuencial
 * (con semáforo de latexmk dentro de runExportDocuments).
 */
async function runFormatExports(
  progress: ProgressTracker,
  ctx: BuildContext,
  work: WorkSets,
  plan: BuildMetadata,
  formatCfg: FormatConfig | undefined,
  options: BuildOptions,
  formatsDir: string,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const noExport = options.noExport === true;
  const exportBase = { cwd: ctx.cwd, lang: ctx.siteConfig.lang, concurrency: ctx.concurrency };

  await Promise.all([
    // Markdown
    (async () => {
      if (!plan.mdOn || noExport) return;
      const mdDocs = work.exportSets.markdown;
      if (mdDocs.length === 0) return;
      progress.startPhase('markdown', mdDocs.length);
      await runExportDocuments(mdDocs, {
        ...exportBase,
        outputDir: join(formatsDir, 'markdown'),
        config: { markdown: formatCfg?.markdown },
        siteConfig: ctx.siteConfig,
        onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, phase: 'markdown' }),
      });
      progress.completePhase(undefined, 'markdown');
    })(),

    // HTML (template completo)
    (async () => {
      if (!plan.htmlOn || noExport) return;
      const htmlDocs = work.exportSets.html;
      if (htmlDocs.length === 0) return;
      progress.startPhase('html', htmlDocs.length);
      await generateHtmlPages(ctx, htmlDocs, formatsDir, options, (relativePath) => progress.reportFile({ relativePath, phase: 'html' }));
      progress.completePhase(undefined, 'html');
    })(),

    // EPUB
    (async () => {
      if (!plan.epubOn || noExport) return;
      const epubDocs = work.exportSets.epub;
      if (epubDocs.length === 0) return;
      progress.startPhase('epub', epubDocs.length);
      await runExportDocuments(epubDocs, {
        ...exportBase,
        outputDir: join(formatsDir, 'html'),
        config: { epub: formatCfg?.epub },
        siteConfig: ctx.siteConfig,
        onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, phase: 'epub' }),
      });
      progress.completePhase(undefined, 'epub');
    })(),

    // LaTeX → PDF (secuencial dentro de la misma rama)
    (async () => {
      if (!plan.pdfOn && !plan.latexOn) return;
      const pdfDocs = work.exportSets.pdf;
      if (pdfDocs.length === 0) return;
      const pdfRelPaths = pdfDocs.map((d) => d.relativePath);
      if (pdfRelPaths.length > 0) {
        progress.startPhase('latex', pdfRelPaths.length);
        await generateLatexPreamble(ctx.cwd, ctx.siteConfig, discoveryIndex, pdfRelPaths);
        progress.completePhase(undefined, 'latex');
      }

      if (plan.pdfOn && !noExport) {
        progress.startPhase('pdf', pdfDocs.length);
        await runExportDocuments(pdfDocs, {
          ...exportBase,
          outputDir: join(formatsDir, 'pdf'),
          config: { pdf: formatCfg?.pdf },
          siteConfig: ctx.siteConfig,
          onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, phase: 'pdf' }),
        });
        progress.completePhase(undefined, 'pdf');
      }
    })(),
  ]);
}

// ── Funciones extraídas ───────────────────────────────────────────────────

async function cleanupRemovedFormats(ctx: BuildContext, allDocs: BuildDocument[], removedFormats: string[]): Promise<void> {
  if (removedFormats.length === 0) return;

  const FORMAT_EXT_MAP: Record<string, string> = {
    latex: '.tex',
    pdf: '.pdf',
    html: '.html',
    epub: '.epub',
    markdown: '.md',
  };
  for (const doc of allDocs) {
    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    const dir = dirname(doc.relativePath);
    for (const fmt of removedFormats) {
      const ext = FORMAT_EXT_MAP[fmt];
      if (ext) {
        await rm(join(ctx.outputDir, dir, `${slug}${ext}`), { force: true }).catch(() => {});
      }
    }
  }

  if (removedFormats.includes('html')) {
    await rm(join(ctx.outputDir, 'css'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'fonts'), { recursive: true, force: true }).catch(() => {});
    await rm(join(ctx.outputDir, 'logo.svg'), { force: true }).catch(() => {});
  }
}

async function cleanupDeletedFiles(
  ctx: BuildContext,
  changedPaths: Set<string>,
  allDocs: BuildDocument[],
  deletedEntries: Map<string, DiscoveryEntry>,
): Promise<void> {
  const allDocPathsSet = new Set(allDocs.map((d) => d.relativePath));
  const deletedMdPaths = [...changedPaths].filter((p) => p.endsWith('.md') && !allDocPathsSet.has(p));
  if (deletedMdPaths.length === 0) return;

  const cacheBase = join(ctx.cwd, '.iteraciones');
  for (const relPath of deletedMdPaths) {
    const dir = dirname(relPath);
    const entry = deletedEntries.get(relPath);
    const slug = entry?.slug ?? basename(relPath, '.md');
    await rm(join(cacheBase, 'tex', dir, `${slug}.tex`), { force: true }).catch(() => {});
    await rm(join(cacheBase, 'html', dir, `${slug}.html`), { force: true }).catch(() => {});
    await rm(join(cacheBase, 'ast', dir, `${slug}.json`), { force: true }).catch(() => {});
    await rm(join(cacheBase, 'tex', dir, `${slug}.flags.json`), { force: true }).catch(() => {});
    for (const sub of ['pdf', 'html']) {
      await rm(join(cacheBase, 'formats', sub, dir, `${slug}.tex`), { force: true }).catch(() => {});
      await rm(join(cacheBase, 'formats', sub, dir, `${slug}.html`), { force: true }).catch(() => {});
      await rm(join(cacheBase, 'formats', sub, dir, `${slug}.epub`), { force: true }).catch(() => {});
    }
    for (const ext of ['.html', '.tex', '.pdf', '.epub', '.md']) {
      await rm(join(ctx.outputDir, dir, `${slug}${ext}`), { force: true }).catch(() => {});
    }
  }
}

async function cleanupSlugChanges(ctx: BuildContext, slugChangedEntries: Map<string, string>): Promise<void> {
  if (slugChangedEntries.size === 0) return;

  const cacheBase = join(ctx.cwd, '.iteraciones');
  for (const [relPath, oldSlug] of slugChangedEntries) {
    const dir = dirname(relPath);
    await rm(join(cacheBase, 'tex', dir, `${oldSlug}.tex`), { force: true }).catch(() => {});
    await rm(join(cacheBase, 'html', dir, `${oldSlug}.html`), { force: true }).catch(() => {});
    await rm(join(cacheBase, 'ast', dir, `${oldSlug}.json`), { force: true }).catch(() => {});
    await rm(join(cacheBase, 'tex', dir, `${oldSlug}.flags.json`), { force: true }).catch(() => {});
    for (const sub of ['pdf', 'html']) {
      await rm(join(cacheBase, 'formats', sub, dir, `${oldSlug}.tex`), { force: true }).catch(() => {});
      await rm(join(cacheBase, 'formats', sub, dir, `${oldSlug}.html`), { force: true }).catch(() => {});
      await rm(join(cacheBase, 'formats', sub, dir, `${oldSlug}.epub`), { force: true }).catch(() => {});
    }
    for (const ext of ['.html', '.tex', '.pdf', '.epub', '.md']) {
      await rm(join(ctx.outputDir, dir, `${oldSlug}${ext}`), { force: true }).catch(() => {});
    }
  }
}

async function copyToDist(
  ctx: BuildContext,
  allDocs: BuildDocument[],
  formatsDir: string,
  active: { latexOn: boolean; pdfOn: boolean; htmlOn: boolean; epubOn: boolean; mdOn: boolean },
): Promise<void> {
  const copySpec: Array<[boolean, string, string]> = [
    [active.latexOn, 'pdf', 'tex'],
    [active.pdfOn, 'pdf', 'pdf'],
    [active.htmlOn, 'html', 'html'],
    [active.epubOn, 'html', 'epub'],
    [active.mdOn, 'markdown', 'md'],
  ];
  for (const doc of allDocs) {
    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    const dir = dirname(doc.relativePath);
    for (const [active, format, ext] of copySpec) {
      if (!active) continue;
      const srcPath = join(formatsDir, format, dir, `${slug}.${ext}`);
      const dstPath = join(ctx.outputDir, dir, `${slug}.${ext}`);
      if (await Bun.file(srcPath).exists()) {
        await mkdir(dirname(dstPath), { recursive: true });
        await Bun.write(dstPath, Bun.file(srcPath));
      }
    }
  }
}

function buildFormatsList(active: { latexOn: boolean; pdfOn: boolean; htmlOn: boolean; epubOn: boolean; mdOn: boolean }): string[] {
  const formats: string[] = [];
  if (active.latexOn) formats.push('latex');
  if (active.pdfOn) formats.push('pdf');
  if (active.htmlOn) formats.push('html');
  if (active.epubOn) formats.push('epub');
  if (active.mdOn) formats.push('markdown');
  return formats;
}
