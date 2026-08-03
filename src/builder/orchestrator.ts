import { mkdir, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ProgressTracker } from '../cli/progress.js';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/site-config.js';
import { computeActiveFormats } from '../config/site-config.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import { buildAssets, generateLatexPreamble } from './build-utils.js';
import { buildDocsFromIndex, discover, loadBuildState } from './discover.js';
import { runExportDocuments } from './export/runner.js';
import { validateDisabledPreambleTranspilers } from './preamble-loader.js';
import { readAstFromCache, renderFromAstCache, renderHtmlPageFromAst, renderLatex, validateDisabledTranspilers } from './render.js';
import { computeBibHash, computeConfigHashes, computeTranspilerHash, discoverBibFiles } from './state.js';
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
  // Validar nombres de transpilers desactivados (warning sin romper el build)
  validateDisabledTranspilers(siteConfig.disabledTranspilers);
  validateDisabledPreambleTranspilers(siteConfig.disabledPreambleTranspilers);
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
      log(`Nuevos formatos detectados: ${newFormats.join(', ')}. Generando sus salidas para todos los documentos.`);
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
  // EPUB, Markdown y HTML se exportan directamente desde el AST canónico
  // (json → epub3/markdown, json → html5 + template de pandoc)
  const generateLatex = pdfOn || latexOn;

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

  // Los formatos nuevos no fuerzan re-render: el AST canónico en disco
  // (`.iteraciones/ast/`) permite exportar sus salidas sin re-ejecutar
  // markdown → json (los exportSets ya incluyen todos los docs vía
  // formatInvalidated, que cambia al activarse un formato).

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

  // ── FASE 2+3: markdown → AST canónico → salidas por formato activo ──
  // renderDocs: AST invalidado (markdown/transpilers/bibliografía cambiados).
  // astExportCandidates: LaTeX/PDF nuevos con AST válido en disco → solo
  // regenerar el tex body (HTML/EPUB/Markdown leen el AST directamente).
  const newPdf = (pdfOn || latexOn) && (newFormats.includes('pdf') || newFormats.includes('latex'));
  const astExportCandidates = allDocs.filter((d) => !astChanged.has(d.relativePath) && newPdf);

  const processedPaths = new Set<string>();
  if (renderDocs.length > 0 || astExportCandidates.length > 0) {
    progress.startPhase('render', renderDocs.length + astExportCandidates.length);
    if (renderDocs.length > 0) {
      const done = await renderLatex(renderDocs, ctx.concurrency, cwd, ctx.siteConfig.disabledTranspilers, generateLatex);
      for (const p of done) processedPaths.add(p);
    }
    if (astExportCandidates.length > 0) {
      const done = await renderFromAstCache(astExportCandidates, ctx.concurrency, cwd, generateLatex, ctx.siteConfig.disabledTranspilers);
      // Docs sin AST en disco (primer build, caché limpiada): pipeline completo
      const missingAstDocs = astExportCandidates.filter((d) => !done.has(d.relativePath));
      if (missingAstDocs.length > 0) {
        const extra = await renderLatex(missingAstDocs, ctx.concurrency, cwd, ctx.siteConfig.disabledTranspilers, generateLatex);
        for (const p of extra) done.add(p);
      }
      for (const p of done) processedPaths.add(p);
    }
    progress.completePhase();
  }

  // Los exports leen sus inputs del caché en disco (AST/tex):
  // no hay hidratación de cuerpos en memoria.

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
      await generateHtmlPages(ctx, htmlDocs, formatsDir, options, (relativePath) => progress.reportFile({ relativePath, phase: 'html' }));
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

async function generateHtmlPages(
  ctx: BuildContext,
  pipelineDocs: BuildDocument[],
  formatsDir: string,
  options: BuildOptions,
  onProgress?: (relativePath: string) => void,
): Promise<void> {
  const siteConfig = ctx.siteConfig;
  const htmlConfig = siteConfig.format?.html;
  const hasCss = !options.noTailwind && ctx.cssPath;
  const bibFiles = discoverBibFiles(ctx.cwd, ['bib']);
  const firstBib = bibFiles[0];
  const bibOptions = firstBib !== undefined ? { bibliography: firstBib, csl: join(import.meta.dir, '../../src/lib/resources/apa-7.csl') } : undefined;
  // Cada documento es independiente (lee AST del disco, escribe su HTML): paralelizar
  await mapWithConcurrency(pipelineDocs, ctx.concurrency, async (doc) => {
    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    const dir = dirname(doc.relativePath);
    const dst = join(formatsDir, 'html', dir, `${slug}.html`);
    const ast = await readAstFromCache(ctx.cwd, doc);
    if (!ast) {
      logWarning(`sin AST en caché para ${doc.relativePath}; se omite la página HTML`, 'orchestrator');
      return;
    }
    let logoInline: string | undefined;
    try {
      const logoRel = siteConfig.logo?.trim();
      const logoSrc = logoRel ? join(ctx.cwd, logoRel) : join(import.meta.dir, '../../src/lib/resources/logo.svg');
      logoInline = await Bun.file(logoSrc).text();
    } catch (err) {
      logWarning(`no se pudo leer el logo para ${doc.relativePath}: ${String(err)}`, 'orchestrator');
    }
    try {
      const html = await renderHtmlPageFromAst(
        ast,
        doc,
        ctx.cwd,
        {
          title: doc.frontmatter.title || slug,
          siteTitle: siteConfig.title ?? '',
          tagline: siteConfig.tagline,
          lang: siteConfig.lang ?? 'es',
          baseUrl: siteConfig.baseUrl,
          theme: htmlConfig?.theme,
          accent: htmlConfig?.accent,
          css: hasCss ? 'css/styles.css' : undefined,
          authorMeta: doc.frontmatter.author.join(', '),
          logoInline,
        },
        bibOptions,
        ctx.siteConfig.disabledTranspilers,
      );
      await mkdir(dirname(dst), { recursive: true });
      await Bun.write(dst, html);
      onProgress?.(doc.relativePath);
    } catch (err) {
      logWarning(`error al generar HTML para ${doc.relativePath}: ${String(err)}`, 'orchestrator');
    }
  });
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
