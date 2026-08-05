import { mkdir, rename, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ProgressTracker } from '../cli/progress.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { computeActiveFormats, type FormatConfig, type SiteConfig } from '../config/site-config.js';
import { logInfo } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import { buildAssets } from './build-assets.js';
import { type BuildMetadata, computeBuildMetadata, computeWorkSets, type WorkSets } from './build-planner.js';
import { buildDocsFromIndex, discover, loadBuildState } from './discover.js';
import { runDocumentPipeline } from './pipeline.js';
import { validateDisabledPreambleFilters } from './preamble-loader.js';
import { validateDisabledFilters } from './render.js';
import type { BuildContext, BuildDocument, DiscoveryEntry } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  concurrency?: number;
  noCache?: boolean;
  noCss?: boolean;
  noExport?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  profile?: boolean;
}

async function setupBuildEnvironment(cwd: string, siteConfig: SiteConfig, options: BuildOptions): Promise<BuildContext> {
  const defaultOutputDir = join(cwd, 'dist', 'files');
  // Límite superior de 16: en máquinas con muchos núcleos, demasiados procesos
  // simultáneos saturan el sistema de archivos y degradan el rendimiento.
  // Solo aplica al default automático: `--concurrency` explícito se respeta.
  const defaultConcurrency = Math.min(Math.max(1, cpus().length - 1), 16);
  const ctx: BuildContext = {
    siteConfig,
    cwd,
    outputDir: options.outputDir ?? defaultOutputDir,
    cssPath: '',
    concurrency: options.concurrency ?? defaultConcurrency,
  };

  if (options.noCache) {
    await rm(ctx.outputDir, { recursive: true, force: true });
    await rm(join(cwd, '.iteraciones'), { recursive: true, force: true });
  }

  return ctx;
}

export async function build(cwd: string, options: BuildOptions = {}): Promise<void> {
  if (options.dryRun) {
    await dryRun(cwd);
    return;
  }

  const progress = new ProgressTracker({ renderer: options.verbose ? 'verbose' : 'default', profile: options.profile });
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

/**
 * Muestra los documentos que se procesarían sin generar salida.
 * Descubre con noCache (sin escribir state.json) y marca el estado
 * previo por documento desde el state.json existente (solo lectura).
 */
async function dryRun(cwd: string): Promise<void> {
  const siteConfig = await loadSiteConfig(cwd);
  const formats = computeActiveFormats(siteConfig.format);
  const prevState = await loadBuildState(cwd);
  const { relativePaths, discoveryIndex } = await discover(cwd, { noCache: true });
  const sourceDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);
  for (const doc of sourceDocs) {
    doc.slug = discoveryIndex.get(doc.relativePath)?.slug ?? basename(doc.relativePath, '.md');
  }

  const formatStr = formats.length > 0 ? formats.join(', ') : '(ninguno)';
  logInfo(`Se procesarían ${sourceDocs.length} documentos`, 'dry-run');
  logInfo(`Formatos activos: ${formatStr}`, 'dry-run');
  if (sourceDocs.length === 0) return;

  const rows = sourceDocs.map((doc) => ({
    path: doc.relativePath,
    slug: doc.slug ?? '',
    cached: prevState?.entries.has(doc.relativePath) ?? false,
  }));
  const pathWidth = Math.max(...rows.map((r) => r.path.length), 'DOCUMENTO'.length);
  const slugWidth = Math.max(...rows.map((r) => r.slug.length), 'SLUG'.length);

  logInfo('');
  logInfo(`  ${'DOCUMENTO'.padEnd(pathWidth)}  ${'SLUG'.padEnd(slugWidth)}  ESTADO`);
  for (const row of rows) {
    logInfo(`  ${row.path.padEnd(pathWidth)}  ${row.slug.padEnd(slugWidth)}  ${row.cached ? 'en caché' : 'nuevo'}`);
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

  // Los 5 formatos configurados se muestran siempre en el tracker: activos con
  // ✔ (su trabajo se completa en el pipeline), desactivados con ✗.
  progress.setFormats([
    { phase: 'latex', active: plan.latexOn },
    { phase: 'pdf', active: plan.pdfOn },
    { phase: 'html', active: plan.htmlOn },
    { phase: 'epub', active: plan.epubOn },
    { phase: 'markdown', active: plan.mdOn },
  ]);

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
    meta: {
      filtersHash: plan.filtersHash,
      filterFileCache: plan.filterFileCache,
      configHashes: plan.configHashes,
      bibHash: plan.bibHash,
      cssInputHash: plan.cssInputHash,
    },
  });
  const allDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);

  if (allDocs.length === 0) {
    logInfo('No se encontraron documentos Markdown en el proyecto.', 'build');
    logInfo("Crea un archivo .md con frontmatter o ejecuta 'iteraciones init'.", 'build');
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
    log('Ningún documento modificado — sin cambios');
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
    log('Ningún documento modificado — sin cambios');
    await progress.finish(0, allDocs.length, []);
    return;
  }

  // Declarar al tracker las fases que se ejecutarán (TTY: libera discovery para
  // que listr2 evalúe los skips con la información completa). Las subtareas de
  // formato se controlan por setFormats; aquí solo se declaran las fases de
  // pipeline (render se salta en early returns sin trabajo).
  await progress.planPhases(['discovery', 'render']);

  const formatCfg = siteConfig.format;

  // ── FASE 2-6: pipeline por documento (AST → formatos ligeros → .tex → PDF) ──
  const formatsDir = join(cwd, '.iteraciones', 'formats');
  const workDocCount = new Set([
    ...work.renderDocs.map((d) => d.relativePath),
    ...work.exportSets.html.map((d) => d.relativePath),
    ...work.exportSets.epub.map((d) => d.relativePath),
    ...work.exportSets.markdown.map((d) => d.relativePath),
    ...work.exportSets.pdf.map((d) => d.relativePath),
  ]).size;

  progress.startPhase('render', workDocCount);
  const { processed } = await runDocumentPipeline(progress, ctx, plan, work, formatCfg, formatsDir, discoveryIndex, {
    noExport: options.noExport === true,
  });
  progress.completePhase(workDocCount, 'render');

  // ── Build assets (css, fonts, logo) antes de copiar a dist/ ──
  if (plan.htmlOn) {
    await buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, {
      noCss: options.noCss,
      prevCssInputHash: prevState?.cssInputHash,
      anyWork: work.anyWork,
    });
  }

  // ── FASE 5: copiar de formats/ a dist/ ──
  await copyToDist(ctx, allDocs, formatsDir, { latexOn: plan.latexOn, pdfOn: plan.pdfOn, htmlOn: plan.htmlOn, epubOn: plan.epubOn, mdOn: plan.mdOn });

  const totalDocs = plan.htmlOn || plan.pdfOn || plan.epubOn || plan.mdOn || plan.latexOn ? allDocs.length : 0;
  const processedCount = processed.size;
  const cachedCount = totalDocs - processedCount;
  await progress.finish(
    processedCount,
    cachedCount,
    buildFormatsList({ latexOn: plan.latexOn, pdfOn: plan.pdfOn, htmlOn: plan.htmlOn, epubOn: plan.epubOn, mdOn: plan.mdOn }),
  );
}

/**
 * FASE 5: limpiar de dist/ archivos de formatos eliminados.
 */
// ── Funciones extraídas ───────────────────────────────────────────────────

/** Extensiones de salida estándar por documento en dist/. */
const OUTPUT_EXTENSIONS = ['.html', '.tex', '.pdf', '.epub', '.md'];

const FORMAT_EXT_MAP: Record<string, string> = {
  latex: '.tex',
  pdf: '.pdf',
  html: '.html',
  epub: '.epub',
  markdown: '.md',
};

/** Elimina los artefactos cacheados de un documento (`.iteraciones/`). */
async function removeCachedArtifacts(cacheBase: string, dir: string, slug: string): Promise<void> {
  await rm(join(cacheBase, 'tex', dir, `${slug}.tex`), { force: true }).catch(() => {});
  await rm(join(cacheBase, 'html', dir, `${slug}.html`), { force: true }).catch(() => {});
  await rm(join(cacheBase, 'ast', dir, `${slug}.json`), { force: true }).catch(() => {});
  await rm(join(cacheBase, 'tex', dir, `${slug}.flags.json`), { force: true }).catch(() => {});
  for (const sub of ['pdf', 'html']) {
    for (const ext of ['.tex', '.html', '.epub']) {
      await rm(join(cacheBase, 'formats', sub, dir, `${slug}${ext}`), { force: true }).catch(() => {});
    }
  }
}

/** Elimina archivos de salida de un documento en dist/ (por extensiones). */
async function removeOutputFiles(outputDir: string, dir: string, slug: string, extensions: string[]): Promise<void> {
  for (const ext of extensions) {
    await rm(join(outputDir, dir, `${slug}${ext}`), { force: true }).catch(() => {});
  }
}

/** Limpia caché y salida de documentos identificados por (directorio, slug). */
async function cleanupBySlug(ctx: BuildContext, entries: Iterable<{ dir: string; slug: string }>): Promise<void> {
  const cacheBase = join(ctx.cwd, '.iteraciones');
  for (const { dir, slug } of entries) {
    await removeCachedArtifacts(cacheBase, dir, slug);
    await removeOutputFiles(ctx.outputDir, dir, slug, OUTPUT_EXTENSIONS);
  }
}

async function cleanupRemovedFormats(ctx: BuildContext, allDocs: BuildDocument[], removedFormats: string[]): Promise<void> {
  if (removedFormats.length === 0) return;

  const extensions = removedFormats.map((fmt) => FORMAT_EXT_MAP[fmt]).filter((ext): ext is string => ext !== undefined);
  for (const doc of allDocs) {
    await removeOutputFiles(ctx.outputDir, dirname(doc.relativePath), doc.slug ?? basename(doc.relativePath, '.md'), extensions);
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

  const entries = deletedMdPaths.map((relPath) => ({
    dir: dirname(relPath),
    slug: deletedEntries.get(relPath)?.slug ?? basename(relPath, '.md'),
  }));
  await cleanupBySlug(ctx, entries);
}

async function cleanupSlugChanges(ctx: BuildContext, slugChangedEntries: Map<string, string>): Promise<void> {
  if (slugChangedEntries.size === 0) return;

  const entries = [...slugChangedEntries].map(([relPath, oldSlug]) => ({ dir: dirname(relPath), slug: oldSlug }));
  await cleanupBySlug(ctx, entries);
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
  // Aplanar las copias (doc × formato) y ejecutarlas en paralelo: son
  // independientes entre sí. Límite 20 para no saturar el sistema de archivos.
  const copies: Array<{ srcPath: string; dstPath: string }> = [];
  for (const doc of allDocs) {
    const slug = doc.slug ?? basename(doc.relativePath, '.md');
    const dir = dirname(doc.relativePath);
    for (const [isActive, format, ext] of copySpec) {
      if (!isActive) continue;
      copies.push({ srcPath: join(formatsDir, format, dir, `${slug}.${ext}`), dstPath: join(ctx.outputDir, dir, `${slug}.${ext}`) });
    }
  }
  await mapWithConcurrency(copies, 20, async ({ srcPath, dstPath }) => {
    await mkdir(dirname(dstPath), { recursive: true });
    // Mover (no copiar): el archivo ya existe en .iteraciones/formats/ y solo
    // cambia de ubicación. rename es O(1) en el mismo dispositivo; copiar
    // leería y reescribiría el contenido completo.
    await rename(srcPath, dstPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return; // formato no generado para este doc
      throw err;
    });
  });
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
