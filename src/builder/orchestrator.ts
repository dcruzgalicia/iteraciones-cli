import { mkdir, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ProgressTracker } from '../cli/progress.js';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/site-config.js';
import { computeActiveFormats } from '../config/site-config.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import { buildAssets, generateLatexPreamble, renderHtmlPage } from './build-utils.js';
import { buildDocsFromIndex, discover, loadBuildState } from './discover.js';
import { runExportDocuments } from './export/runner.js';
import type { RenderLatexResult } from './render.js';
import { renderLatex } from './render.js';
import { computeBibHash, computeConfigHashes, computeTranspilerHash } from './state.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  concurrency?: number;
  noCache?: boolean;
  noTailwind?: boolean;
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

  const progress = new ProgressTracker({ verbose: options.verbose ?? false });
  const log = (msg: string) => progress.log(msg);

  // Cargar config primero para detectar cambios de formato antes de setupBuildEnvironment
  const siteConfig = await loadSiteConfig(cwd);
  const currentFormats = computeActiveFormats(siteConfig.format);
  let newFormats: string[] = [];
  let removedFormats: string[] = [];

  // Estado del build anterior + hashes de invalidación (caché content-addressed)
  const prevState = await loadBuildState(cwd);
  const configHashes = await computeConfigHashes(cwd, siteConfig);
  const transpilerHash = await computeTranspilerHash(cwd, siteConfig);
  const bibHash = await computeBibHash(cwd);

  const prevHashes = prevState?.configHashes;
  const formatInvalidated = {
    pdf: prevState !== null && prevHashes?.pdf !== configHashes.pdf,
    html: prevState !== null && prevHashes?.html !== configHashes.html,
    epub: prevState !== null && prevHashes?.epub !== configHashes.epub,
    markdown: prevState !== null && prevHashes?.markdown !== configHashes.markdown,
  };
  const transpilersInvalidated = prevState !== null && prevState.transpilerHash !== transpilerHash;
  const bibInvalidated = prevState !== null && prevState.bibHash !== bibHash;

  if (prevState !== null) {
    const prevFormats = new Set(prevState.activeFormats);
    newFormats = currentFormats.filter((f) => !prevFormats.has(f));
    removedFormats = prevState.activeFormats.filter((f) => !currentFormats.includes(f));
    if (newFormats.length > 0) {
      log(`Nuevos formatos detectados: ${newFormats.join(', ')}. Procesando todos los documentos.`);
    }
    if (removedFormats.length > 0) {
      log(`Formatos eliminados: ${removedFormats.join(', ')}. Limpiando archivos de dist.`);
    }
  }

  if (transpilersInvalidated) log('Transpilers modificados — reprocesando todos los documentos');
  if (bibInvalidated) log('Bibliografía modificada — reprocesando todos los documentos');
  if (formatInvalidated.pdf) log('Configuración PDF/LaTeX modificada — regenerando LaTeX/PDF');
  if (formatInvalidated.html) log('Configuración HTML modificada — regenerando páginas HTML');
  if (formatInvalidated.epub) log('Configuración EPUB modificada — regenerando EPUBs');
  if (formatInvalidated.markdown) log('Configuración Markdown modificada — regenerando exports Markdown');

  if (options.noCache) {
    progress.showCleanup();
  }

  const ctx = await setupBuildEnvironment(cwd, siteConfig, options);

  const formatCfg = ctx.siteConfig.format;
  const pdfOn = formatCfg?.pdf?.generate === true;
  const latexOn = formatCfg?.latex === true;
  const htmlOn = formatCfg?.html?.generate === true;
  const epubOn = formatCfg?.epub?.generate === true;
  const mdOn = formatCfg?.markdown?.generate === true;
  const needsHtml = htmlOn || epubOn;

  const needsCss = htmlOn && !options.noTailwind;
  ctx.cssPath = needsCss ? '/css/styles.css' : '';

  progress.startPhase('discovery');
  const {
    relativePaths,
    changedPaths: discoveredChanges,
    discoveryIndex,
    deletedEntries,
    slugChangedEntries,
  } = await discover(cwd, {
    noCache: options.noCache,
    activeFormats: currentFormats,
    prevState,
    meta: { transpilerHash, configHashes, bibHash },
  });
  const allDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);

  if (allDocs.length === 0) {
    process.stdout.write('  No se encontraron documentos Markdown en el proyecto.\n');
    process.stdout.write("  Crea un archivo .md con frontmatter o ejecuta 'iteraciones init'.\n");
    progress.finish(0, 0, []);
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

  // Si hay formatos nuevos, forzar que todos los documentos pasen por el pipeline
  if (newFormats.length > 0) {
    for (const doc of allDocs) {
      discoveredChanges.add(doc.relativePath);
    }
  }

  // ── FASE 6: limpiar de dist/ archivos de formatos eliminados ──
  await cleanupRemovedFormats(ctx, allDocs, removedFormats);

  // ── Conjuntos de trabajo (caché content-addressed) ──
  // astChanged: documentos cuyo AST debe regenerarse (markdown cambiado, transpilers o bibliografía)
  const astChanged = new Set(discoveredChanges);
  const allPaths = new Set(allDocs.map((d) => d.relativePath));
  if (transpilersInvalidated || bibInvalidated) {
    for (const p of allPaths) {
      astChanged.add(p);
    }
  }

  const anyWork =
    astChanged.size > 0 ||
    (formatInvalidated.pdf && (pdfOn || latexOn)) ||
    (formatInvalidated.html && htmlOn) ||
    (formatInvalidated.epub && epubOn) ||
    (formatInvalidated.markdown && mdOn);

  if (!anyWork) {
    log('Ningun documento modificado — sin cambios');
    progress.finish(0, allDocs.length, []);
    return;
  }

  // Cleanup de archivos eliminados y slugs cambiados
  await cleanupDeletedFiles(ctx, discoveredChanges, allDocs, deletedEntries);
  await cleanupSlugChanges(ctx, slugChangedEntries);

  const renderDocs = allDocs.filter((d) => astChanged.has(d.relativePath));
  const exportSets = {
    pdf: pdfOn || latexOn ? allDocs.filter((d) => astChanged.has(d.relativePath) || formatInvalidated.pdf) : [],
    html: htmlOn ? allDocs.filter((d) => astChanged.has(d.relativePath) || formatInvalidated.html) : [],
    epub: epubOn ? allDocs.filter((d) => astChanged.has(d.relativePath) || formatInvalidated.epub) : [],
    markdown: mdOn ? allDocs.filter((d) => astChanged.has(d.relativePath) || formatInvalidated.markdown) : [],
  };

  // Solo hubo eliminaciones o slugs cambiados: el cleanup ya corrió
  if (
    renderDocs.length === 0 &&
    exportSets.pdf.length === 0 &&
    exportSets.html.length === 0 &&
    exportSets.epub.length === 0 &&
    exportSets.markdown.length === 0
  ) {
    log('Ningun documento modificado — sin cambios');
    progress.finish(0, allDocs.length, []);
    return;
  }

  // ── FASE 2+3: markdown → latex → html (solo docs con AST invalidado) ──
  let renderResults: Map<string, RenderLatexResult> = new Map();
  if (renderDocs.length > 0) {
    progress.startPhase('render', renderDocs.length);
    renderResults = await renderLatex(renderDocs, ctx.concurrency, cwd, ctx.siteConfig.disabledTranspilers, needsHtml);
    for (const doc of allDocs) {
      const result = renderResults.get(doc.relativePath);
      if (result) {
        doc.processedBody = result.processedBody;
        doc.htmlFragment = result.htmlFragment;
        doc.slug = result.slug;
      }
    }
    progress.completePhase();
  }

  // Docs que se exportan sin re-render: hidratar cuerpos cacheados desde el disco
  const hydrateTargets = [...exportSets.pdf, ...exportSets.epub, ...exportSets.markdown].filter((d) => !renderResults.has(d.relativePath));
  if (hydrateTargets.length > 0) {
    await mapWithConcurrency(hydrateTargets, ctx.concurrency, async (doc) => {
      const slug = doc.slug ?? basename(doc.relativePath, '.md');
      const dir = dirname(doc.relativePath);
      const cacheBase = join(cwd, '.iteraciones');
      const tex = await Bun.file(join(cacheBase, 'tex', dir, `${slug}.tex`))
        .text()
        .catch(() => '');
      if (tex) doc.processedBody = tex;
      const html = await Bun.file(join(cacheBase, 'html', dir, `${slug}.html`))
        .text()
        .catch(() => '');
      if (html) doc.htmlFragment = html;
    });
  }

  // Preparar datos para FASE 4
  const noExport = options.noExport === true;
  const formatsDir = join(cwd, '.iteraciones', 'formats');
  const exportBase = { cwd, lang: ctx.siteConfig.lang, concurrency: ctx.concurrency };

  const countExportDocs = (docs: BuildDocument[]): number => docs.length;

  // ── FASE 4: 4 ramas en paralelo ──
  await Promise.all([
    // Markdown
    (async () => {
      if (!mdOn || noExport) return;
      const mdDocs = exportSets.markdown;
      if (mdDocs.length === 0) return;
      const mdTotal = countExportDocs(mdDocs);
      progress.startPhase('markdown', mdTotal);
      await runExportDocuments(mdDocs, {
        ...exportBase,
        outputDir: join(formatsDir, 'markdown'),
        config: { markdown: formatCfg?.markdown },
        onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, phase: 'markdown' }),
      });
      progress.completePhase(undefined, 'markdown');
    })(),

    // HTML (template completo)
    (async () => {
      if (!htmlOn || noExport) return;
      const htmlDocs = exportSets.html;
      if (htmlDocs.length === 0) return;
      progress.startPhase('html', htmlDocs.length);
      await generateHtmlPages(ctx, htmlDocs, formatsDir, options);
      progress.completePhase(undefined, 'html');
    })(),

    // EPUB
    (async () => {
      if (!epubOn || noExport) return;
      const epubDocs = exportSets.epub;
      if (epubDocs.length === 0) return;
      const epubTotal = countExportDocs(epubDocs);
      progress.startPhase('epub', epubTotal);
      await runExportDocuments(epubDocs, {
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
      const pdfDocs = exportSets.pdf;
      if (pdfDocs.length === 0) return;
      const pdfRelPaths = pdfDocs.map((d) => d.relativePath);
      if (pdfRelPaths.length > 0) {
        progress.startPhase('latex', pdfRelPaths.length);
        await generateLatexPreamble(cwd, ctx.siteConfig, discoveryIndex, pdfRelPaths);
        progress.completePhase(undefined, 'latex');
      }

      if (pdfOn && !noExport) {
        const pdfTotal = countExportDocs(pdfDocs);
        progress.startPhase('pdf', pdfTotal);
        await runExportDocuments(pdfDocs, {
          ...exportBase,
          outputDir: join(formatsDir, 'pdf'),
          config: { pdf: formatCfg?.pdf },
          onExportProgress: (relativePath: string) => progress.reportFile({ relativePath, phase: 'pdf' }),
        });
        progress.completePhase(undefined, 'pdf');
      }
    })(),
  ]);

  // ── Build assets (css, fonts, logo) antes de copiar a dist/ ──
  if (htmlOn) {
    await buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, { noTailwind: options.noTailwind });
  }

  // ── FASE 5: copiar de formats/ a dist/ ──
  await copyToDist(ctx, allDocs, formatsDir, { latexOn, pdfOn, htmlOn, epubOn, mdOn });

  const totalDocs = htmlOn || pdfOn || epubOn || mdOn || latexOn ? allDocs.length : 0;
  const workedPaths = new Set<string>();
  for (const d of renderDocs) workedPaths.add(d.relativePath);
  for (const list of [exportSets.pdf, exportSets.html, exportSets.epub, exportSets.markdown]) {
    for (const d of list) workedPaths.add(d.relativePath);
  }
  const processedCount = workedPaths.size;
  const cachedCount = totalDocs - processedCount;
  progress.finish(processedCount, cachedCount, buildFormatsList({ latexOn, pdfOn, htmlOn, epubOn, mdOn }));
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
    const CACHE_PATHS = ['tex', 'html'];
    for (const sub of CACHE_PATHS) {
      await rm(join(cacheBase, sub, dir, `${slug}.tex`), { force: true }).catch(() => {});
      await rm(join(cacheBase, sub, dir, `${slug}.html`), { force: true }).catch(() => {});
    }
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
    for (const sub of ['tex', 'html']) {
      await rm(join(cacheBase, sub, dir, `${oldSlug}.tex`), { force: true }).catch(() => {});
      await rm(join(cacheBase, sub, dir, `${oldSlug}.html`), { force: true }).catch(() => {});
    }
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

async function generateHtmlPages(ctx: BuildContext, pipelineDocs: BuildDocument[], formatsDir: string, options: BuildOptions): Promise<void> {
  const siteConfig = ctx.siteConfig;
  const htmlConfig = siteConfig.format?.html;
  const hasCss = !options.noTailwind && ctx.cssPath;
  for (const doc of pipelineDocs) {
    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    const dir = dirname(doc.relativePath);
    const src = join(ctx.cwd, '.iteraciones', 'html', dir, `${slug}.html`);
    const dst = join(formatsDir, 'html', dir, `${slug}.html`);
    try {
      const fragment = await Bun.file(src).text();
      let logoInline: string | undefined;
      try {
        const logoRel = ctx.siteConfig.logo?.trim();
        const logoSrc = logoRel ? join(ctx.cwd, logoRel) : join(import.meta.dir, '../../src/lib/resources/logo.svg');
        logoInline = await Bun.file(logoSrc).text();
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
      });
      await mkdir(dirname(dst), { recursive: true });
      await Bun.write(dst, html);
    } catch {
      logWarning(`error al generar HTML para ${doc.relativePath}`, 'orchestrator');
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
