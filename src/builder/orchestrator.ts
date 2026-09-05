import { exists, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import { type ActiveFormats, computeActiveFormats, type FormatKey, resolveDisabledPreambleConfig } from '../config/site-config.js';
import { BuildError, ConfigError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { logWarning, runWithWarningSink } from '../lib/logger.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { plural } from '../lib/plural.js';
import { buildAssets } from './build-assets.js';
import { type BuildMetadata, computeBuildMetadata, computeWorkSets, type WorkSets } from './build-planner.js';
import { cleanupCoverImages, cleanupDeletedFiles, cleanupRemovedFormats, cleanupSlugChanges } from './cleanup.js';
import { buildDocsFromIndex, discover, htmlSlugFor, resolveDiscoverSlugs } from './discover.js';
import { parseAuthors } from './discover-frontmatter.js';
import { validateDisabledFilters } from './filter-resolver.js';
import { DIST_FILES_DIR, FORMAT_OUTPUT_EXTENSIONS } from './output-layout.js';
import { type PdfxCacheHandle, runPdfxOutputValidation } from './pdfx-check.js';
import { documentPipeline } from './pipeline.js';
import { resolveEffectiveDisabledPreamble, validateDisabledPreambleFilters, validatePreambleDependencies } from './preamble-loader.js';
import { validateConfigFilePaths } from './project-validator.js';

import type { BuildState } from './state-serialize.js';
import { loadStateFile, persistCompletedState } from './state-serialize.js';
import type { BuildContext, BuildDocument, BuildReporter, DiscoveryEntry } from './types.js';

const silentReporter: BuildReporter = {
  setFormats(): void {},
  planPhases(): void {},
  startPhase(): void {},
  reportFile(): void {},
  completePhase(): void {},
  log(): void {},
  addWarning(): void {},
  addSummaryLine(): void {},
  showCleanup(): void {},
  startLightFormats(): void {},
  finish(): Promise<void> {
    return Promise.resolve();
  },
  fail(): Promise<void> {
    return Promise.resolve();
  },
};

export const EMPTY_PROJECT_WARNING_CODES = {
  noDocs: '[empty-project]',
  suggestInit: '[empty-project]',
} as const;

const EMPTY_PROJECT_WARNING_NO_DOCS = 'No se encontraron documentos Markdown en el proyecto.';
const EMPTY_PROJECT_WARNING_INIT = "Crea un archivo .md con frontmatter o ejecuta 'iteraciones init.'";

export interface BuildOptions {
  outputDir?: string;
  full?: boolean;
  verbose?: boolean;
  json?: boolean;
}

export interface BuildSummary {
  processed: number;
  cached: number;
  formats: string[];
  outputDir: string;
  invalidations: string[];
}

async function setupBuildEnvironment(cwd: string, siteConfig: SiteConfig, options: BuildOptions): Promise<BuildContext> {
  const defaultOutputDir = join(cwd, DIST_FILES_DIR);
  const concurrency = Math.min(Math.max(1, cpus().length - 1), 16);
  const ctx: BuildContext = {
    siteConfig,
    cwd,
    outputDir: options.outputDir ?? defaultOutputDir,
    needsCss: false,
    concurrency,
  };

  if (options.full) {
    await rm(ctx.outputDir, { recursive: true, force: true });
    await rm(join(cwd, '.iteraciones'), { recursive: true, force: true });
  }

  return ctx;
}

export async function build(cwd: string, options: BuildOptions = {}, reporter: BuildReporter = silentReporter): Promise<void> {
  const pandocVersion = await getPandocVersion();

  const startedAt = performance.now();
  const progress = reporter;
  let result: BuildSummary | null = null;
  try {
    if (options.verbose) {
      result = await runBuild(cwd, options, progress, pandocVersion);
    } else {
      result = await runWithWarningSink(
        (message) => progress.addWarning(message),
        () => runBuild(cwd, options, progress, pandocVersion),
      );
    }
  } catch (err) {
    await progress.fail();
    if (options.full) {
      const outputDir = options.outputDir ?? join(cwd, DIST_FILES_DIR);
      await rm(outputDir, { recursive: true, force: true });
    }
    throw err;
  }
  if (options.json && result !== null) {
    process.stdout.write(`${JSON.stringify({ ...result, durationMs: Math.round(performance.now() - startedAt) })}\n`);
  }
}

async function resolveEffectiveConfig(cwd: string): Promise<{ siteConfig: SiteConfig; effectiveDisabledPreamble: string[] }> {
  const siteConfig = await loadSiteConfig(cwd);
  validateDisabledFilters(siteConfig.disabledFilters);
  const effectiveDisabledPreamble = resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(siteConfig));
  validateDisabledPreambleFilters(effectiveDisabledPreamble);
  for (const issue of await validateConfigFilePaths(cwd, siteConfig)) {
    if (issue.severity === 'error') {
      throw new ConfigError(`iteraciones.config.yaml: ${issue.message}`, join(cwd, 'iteraciones.config.yaml'));
    }
    logWarning(`iteraciones.config.yaml: ${issue.message}`, 'config');
  }
  for (const issue of validatePreambleDependencies(effectiveDisabledPreamble)) {
    if (issue.severity === 'error') {
      throw new BuildError(`dependencia de preamble filters: ${issue.message}`);
    }
    logWarning(issue.message, 'config');
  }
  return { siteConfig, effectiveDisabledPreamble };
}

function logInvalidations(plan: BuildMetadata, log: (msg: string) => void): void {
  if (plan.newFormats.length > 0) {
    log(`Nuevos formatos detectados: ${plan.newFormats.join(', ')}. Generando sus salidas para todos los documentos.`);
  }
  if (plan.removedFormats.length > 0) {
    log(`Formatos eliminados: ${plan.removedFormats.join(', ')}. Limpiando archivos de dist.`);
  }
  if (plan.filtersInvalidated) log('Filters modificados — reprocesando todos los documentos');
  if (plan.bibInvalidated) log('Bibliografía modificada — regenerando las exportaciones');
  if (plan.formatInvalidated.print) log('Configuración PDF/LaTeX modificada — regenerando LaTeX/PDF');
  if (plan.formatInvalidated.html) log('Configuración HTML modificada — regenerando páginas HTML');
  if (plan.formatInvalidated.epub) log('Configuración EPUB modificada — regenerando EPUBs');
  if (plan.formatInvalidated.markdown) log('Configuración Markdown modificada — regenerando exports Markdown');
}

function collectInvalidations(plan: BuildMetadata, outputDirChanged: boolean): string[] {
  const invalidations: string[] = [];
  if (outputDirChanged) invalidations.push('directorio de salida');
  if (plan.filtersInvalidated) invalidations.push('filters');
  if (plan.bibInvalidated) invalidations.push('bibliografía');
  if (plan.formatInvalidated.print) invalidations.push('configuración PDF/LaTeX');
  if (plan.formatInvalidated.html) invalidations.push('configuración HTML');
  if (plan.formatInvalidated.epub) invalidations.push('configuración EPUB');
  if (plan.formatInvalidated.markdown) invalidations.push('configuración Markdown');
  for (const format of plan.newFormats) invalidations.push(`formato nuevo: ${format}`);
  return invalidations;
}

async function aggregateCollectionCreators(entry: DiscoveryEntry, cwd: string): Promise<void> {
  const aggregated = new Set<string>();
  for (const file of entry.files ?? []) {
    try {
      const text = await Bun.file(join(cwd, file)).text();
      const { yaml } = splitFrontmatter(text);
      if (!yaml) continue;
      const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
      for (const c of parseAuthors(parsed.creator)) aggregated.add(c);
    } catch {}
  }
  entry.creator = [...aggregated];
}

function injectExtratitleFromCreator(entry: DiscoveryEntry): void {
  const fm = entry.fm ?? {};
  if (fm.extratitle === undefined) {
    fm.extratitle = entry.creator.join(', ');
    entry.fm = fm;
  }
}

async function postProcessCollections(discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): Promise<void> {
  for (const entry of discoveryIndex.values()) {
    if (entry.type !== 'collection' || !entry.files) continue;
    if (entry.creator.length === 0) {
      await aggregateCollectionCreators(entry, cwd);
    } else {
      injectExtratitleFromCreator(entry);
    }
  }
}

async function discoverDocuments(
  cwd: string,
  options: BuildOptions,
  plan: BuildMetadata,
  prevState: BuildState | null,
  ctx: BuildContext,
  progress: BuildReporter,
): Promise<{
  allDocs: BuildDocument[];
  discoveryIndex: Map<string, DiscoveryEntry>;
  discoveredChanges: Set<string>;
  deletedEntries: Map<string, DiscoveryEntry>;
  slugChangedEntries: Map<string, string>;
  pendingState: BuildState | null;
}> {
  progress.startPhase('discovery');
  const {
    relativePaths,
    changedPaths: discoveredChanges,
    discoveryIndex,
    deletedEntries,
    slugComputer,
    pendingState,
  } = await discover(cwd, {
    full: options.full,
    activeFormats: plan.currentFormats,
    prevState,
    outputDir: ctx.outputDir,
    meta: {
      filtersHash: plan.filtersHash,
      filterFileCache: plan.filterFileCache,
      schemaFileCache: plan.schemaFileCache,
      configHashes: plan.configHashes,
      configFileCache: plan.configFileCache,
      bibHash: plan.bibHash,
      bibFileCache: plan.bibFileCache,
    },
  });

  await postProcessCollections(discoveryIndex, cwd);

  const { slugChangedEntries, changedPaths: slugChangedPaths } = resolveDiscoverSlugs(discoveryIndex, slugComputer);
  for (const path of slugChangedPaths) discoveredChanges.add(path);
  const collectionFiles = new Set<string>();
  for (const entry of discoveryIndex.values()) {
    if (entry.type === 'collection' && entry.files) {
      for (const f of entry.files) collectionFiles.add(f);
    }
  }
  const filteredPaths = relativePaths.filter((p) => !collectionFiles.has(p));
  const allDocs = buildDocsFromIndex(filteredPaths, discoveryIndex, cwd);
  if (options.verbose) {
    for (const doc of allDocs) {
      progress.reportFile({ relativePath: doc.relativePath, phase: 'discovery' });
    }
  }
  progress.completePhase(allDocs.length);
  for (const doc of allDocs) {
    const entry = discoveryIndex.get(doc.relativePath);
    doc.slug = entry?.slug ?? basename(doc.relativePath, '.md');
  }
  return { allDocs, discoveryIndex, discoveredChanges, deletedEntries, slugChangedEntries, pendingState };
}

async function finishBuild(
  deps: {
    progress: BuildReporter;
    siteConfig: SiteConfig;
    outputDir: string;
    effectiveDisabledPreamble: string[];
    needsAssets: boolean;
    runAssets: () => Promise<void>;
    cwd: string;
    pendingState: BuildState | null;
    prevPdfxCache: Record<string, string> | undefined;
  },
  params: { processedCount: number; cachedCount: number; invalidations: string[]; empty?: boolean },
): Promise<BuildSummary> {
  if (deps.needsAssets) await deps.runAssets();
  const cache: PdfxCacheHandle = { prev: deps.prevPdfxCache ?? {}, out: {} };
  const pdfx = await runPdfxOutputValidation(deps.outputDir, deps.siteConfig, { allowBuild: true }, deps.effectiveDisabledPreamble, cache);
  if (deps.pendingState) deps.pendingState.pdfxCache = cache.out;
  if (pdfx.summaryLine) deps.progress.addSummaryLine(pdfx.summaryLine);
  const formats = params.empty ? [] : computeActiveFormats(deps.siteConfig.format);
  await deps.progress.finish(
    params.processedCount,
    params.cachedCount,
    formats,
    params.empty ? undefined : deps.outputDir,
    params.empty ? undefined : params.invalidations,
  );
  await persistCompletedState(deps.cwd, deps.pendingState);
  return {
    processed: params.processedCount,
    cached: params.cachedCount,
    formats,
    outputDir: deps.outputDir,
    invalidations: params.empty ? [] : params.invalidations,
  };
}

async function prepareEnvironment(
  cwd: string,
  options: BuildOptions,
  siteConfig: SiteConfig,
  plan: BuildMetadata,
  progress: BuildReporter,
): Promise<BuildContext> {
  if (options.full) {
    progress.log('--full: se eliminaron la caché y la salida anterior');
    progress.showCleanup();
  }
  const ctx = await setupBuildEnvironment(cwd, siteConfig, options);
  ctx.needsCss = plan.needsCss;
  progress.setFormats([
    { phase: 'latex', active: plan.activeFormats.latex },
    { phase: 'pdf', active: plan.activeFormats.pdf },
    { phase: 'html', active: plan.activeFormats.html },
    { phase: 'epub', active: plan.activeFormats.epub },
    { phase: 'markdown', active: plan.activeFormats.markdown },
  ]);
  return ctx;
}

async function formatCleanup(
  ctx: BuildContext,
  plan: BuildMetadata,
  allDocs: BuildDocument[],
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<number> {
  let removed = await cleanupRemovedFormats(ctx, allDocs, plan.removedFormats);
  if (plan.activeFormats.pdf) {
    removed += await cleanupCoverImages(ctx, allDocs, siteConfig, discoveryIndex);
  }
  return removed;
}

function planWork(
  plan: BuildMetadata,
  ctx: BuildContext,
  prevState: BuildState | null,
  allDocs: BuildDocument[],
  discoveredChanges: Set<string>,
  log: (msg: string) => void,
): { work: ReturnType<typeof computeWorkSets>; invalidations: string[] } {
  const outputDirChanged = prevState !== null && ctx.outputDir !== prevState.outputDir;
  if (outputDirChanged) {
    log('Directorio de salida modificado — reprocesando todos los documentos');
  }
  const work = computeWorkSets(plan, allDocs, discoveredChanges, outputDirChanged);
  return { work, invalidations: collectInvalidations(plan, outputDirChanged) };
}

async function ensureCachedOutputsComplete(allDocs: BuildDocument[], work: WorkSets, activeFormats: ActiveFormats, outputDir: string): Promise<void> {
  const inWork = new Set(work.workDocList.map((d) => d.relativePath));
  const formatEntries = Object.entries(activeFormats) as [FormatKey, boolean][];
  const fmtToWork: Record<FormatKey, string> = {
    pdf: 'print',
    latex: 'print',
    html: 'html',
    epub: 'epub',
    markdown: 'markdown',
  };

  const hasMissingOutput = async (slug: string, dir: string): Promise<boolean> => {
    for (const [fmt, active] of formatEntries) {
      if (!active) continue;
      const exts = FORMAT_OUTPUT_EXTENSIONS[fmt] ?? [];
      for (const ext of exts) {
        if (!(await exists(join(outputDir, dir, `${slug}${ext}`)))) return true;
      }
    }
    return false;
  };

  for (const doc of allDocs) {
    if (inWork.has(doc.relativePath)) continue;
    const slug = htmlSlugFor(doc.relativePath, doc.slug || basename(doc.relativePath, '.md'));
    const dir = dirname(doc.relativePath);
    if (!(await hasMissingOutput(slug, dir))) continue;
    for (const [fmt, active] of formatEntries) {
      if (!active) continue;
      const key = fmtToWork[fmt] as keyof typeof work.exportSets;
      work.exportSets[key].push(doc);
      work.workPaths[key]?.add(doc.relativePath);
    }
    work.workDocList.push(doc);
  }
}

async function pipelinePhases(
  progress: BuildReporter,
  ctx: BuildContext,
  plan: BuildMetadata,
  work: ReturnType<typeof computeWorkSets>,
  allDocs: BuildDocument[],
  discoveryIndex: Map<string, DiscoveryEntry>,
  effectiveDisabledPreamble: string[],
  formatCfg: SiteConfig['format'] | undefined,
  invalidations: string[],
  fallbackReason: string | null,
): Promise<{ processedCount: number; cachedCount: number; invalidations: string[] }> {
  progress.planPhases(['discovery', 'render']);

  const workDocCount = work.workDocList.length;

  progress.startPhase('render', workDocCount);
  const { processed } = await documentPipeline(progress, ctx, plan, work, formatCfg, discoveryIndex, effectiveDisabledPreamble);

  const totalDocs =
    plan.activeFormats.html || plan.activeFormats.pdf || plan.activeFormats.epub || plan.activeFormats.markdown || plan.activeFormats.latex
      ? allDocs.length
      : 0;
  const processedCount = processed.size;
  const cachedCount = totalDocs - processedCount;
  if (invalidations.length === 0 && processedCount > 0) {
    invalidations.push(fallbackReason ?? plural(processedCount, 'documento modificado', 'documentos modificados'));
  }
  return { processedCount, cachedCount, invalidations };
}

async function runBuild(cwd: string, options: BuildOptions, progress: BuildReporter, pandocVersion: string): Promise<BuildSummary> {
  const log = (msg: string) => progress.log(msg);

  const { siteConfig, effectiveDisabledPreamble } = await resolveEffectiveConfig(cwd);

  const prevState = options.full ? null : await loadStateFile(cwd);
  const plan = await computeBuildMetadata(cwd, siteConfig, prevState, effectiveDisabledPreamble, pandocVersion);
  logInvalidations(plan, log);

  const ctx = await prepareEnvironment(cwd, options, siteConfig, plan, progress);

  const { allDocs, discoveryIndex, discoveredChanges, deletedEntries, slugChangedEntries, pendingState } = await discoverDocuments(
    cwd,
    options,
    plan,
    prevState,
    ctx,
    progress,
  );

  const needsAssets = plan.activeFormats.html;

  const runAssets = async (): Promise<void> => {
    const { cssHash, cssFileCache } = await buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, prevState?.cssHash, prevState?.cssFileCache);
    if (pendingState) {
      pendingState.cssHash = cssHash;
      if (cssFileCache !== undefined) pendingState.cssFileCache = cssFileCache;
    }
  };

  const closeDeps = {
    progress,
    siteConfig,
    outputDir: ctx.outputDir,
    effectiveDisabledPreamble,
    needsAssets,
    runAssets,
    cwd,
    pendingState,
    prevPdfxCache: prevState?.pdfxCache,
  };

  if (allDocs.length === 0) {
    logWarning(EMPTY_PROJECT_WARNING_NO_DOCS, 'build');
    logWarning(EMPTY_PROJECT_WARNING_INIT, 'build');
    return finishBuild(closeDeps, {
      processedCount: 0,
      cachedCount: 0,
      invalidations: [],
      empty: true,
    });
  }

  let cleanedFiles = await formatCleanup(ctx, plan, allDocs, siteConfig, discoveryIndex);

  const { work, invalidations } = planWork(plan, ctx, prevState, allDocs, discoveredChanges, log);

  await ensureCachedOutputsComplete(allDocs, work, plan.activeFormats, ctx.outputDir);

  if (
    !work.anyWork &&
    work.exportSets.print.length === 0 &&
    work.exportSets.html.length === 0 &&
    work.exportSets.epub.length === 0 &&
    work.exportSets.markdown.length === 0 &&
    work.docsChanged.size === 0
  ) {
    log('Ningún documento modificado — sin cambios');
    return finishBuild(closeDeps, {
      processedCount: 0,
      cachedCount: allDocs.length,
      invalidations,
    });
  }

  cleanedFiles += await cleanupDeletedFiles(ctx, discoveredChanges, allDocs, deletedEntries);
  cleanedFiles += await cleanupSlugChanges(ctx, slugChangedEntries);
  if (cleanedFiles > 0) {
    log(`Limpieza de dist: ${plural(cleanedFiles, 'archivo residual eliminado', 'archivos residuales eliminados')}.`);
  }

  if (
    work.docsChanged.size === 0 &&
    work.exportSets.print.length === 0 &&
    work.exportSets.html.length === 0 &&
    work.exportSets.epub.length === 0 &&
    work.exportSets.markdown.length === 0
  ) {
    log('Ningún documento modificado — sin cambios');
    return finishBuild(closeDeps, {
      processedCount: 0,
      cachedCount: allDocs.length,
      invalidations,
    });
  }

  const fallbackReason = prevState === null ? (options.full ? 'build completo desde cero' : 'sin caché previa') : null;
  return finishBuild(
    closeDeps,
    await pipelinePhases(
      progress,
      ctx,
      plan,
      work,
      allDocs,
      discoveryIndex,
      effectiveDisabledPreamble,
      siteConfig.format,
      invalidations,
      fallbackReason,
    ),
  );
}
