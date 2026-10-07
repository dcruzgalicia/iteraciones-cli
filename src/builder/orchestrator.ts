import { exists, realpath, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import { type ActiveFormats, computeActiveFormats, type FormatKey, resolveDisabledPreambleConfig } from '../config/site-config.js';
import { BuildError, ConfigError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { logWarning, runWithWarningSink } from '../lib/logger.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { plural } from '../lib/plural.js';
import { abortScriptCapture, beginScriptCapture, commitScriptCapture } from '../lib/script-recorder.js';
import { buildAssets } from './build-assets.js';
import { type BuildMetadata, computeBuildMetadata, computeWorkSets, FORMAT_TO_WORK, type WorkSets } from './build-planner.js';
import { writeBundle } from './bundle-dist.js';
import { cleanupCoverImages, cleanupDeletedFiles, cleanupRemovedFormats, cleanupSlugChanges, hasLegacyAssetLayout } from './cleanup.js';
import { resolveCollectionFile } from './collection-files.js';
import { buildDocsFromIndex, discover, htmlSlugFor, resolveDiscoverSlugs } from './discover.js';
import { parseAuthors } from './discover-frontmatter.js';
import { validateDisabledFilters } from './filter-resolver.js';
import { DIST_FILES_DIR, docProducesFormat, primaryOutputExtension } from './output-layout.js';
import { type PdfxCacheHandle, runPdfxOutputValidation } from './pdfx-check.js';
import { documentPipeline } from './pipeline.js';
import { resolveCollectionCreatorDocs } from './pipeline-formats.js';
import { resolveEffectiveDisabledPreamble, validateDisabledPreambleFilters, validatePreambleDependencies } from './preamble-loader.js';
import { validateConfigFilePaths, validateConfigRules } from './project-validator.js';

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

  only?: string[];
}

function selectionOf(options: BuildOptions): string[] | undefined {
  return options.only !== undefined && options.only.length > 0 ? options.only : undefined;
}

async function assertSelectionCompatible(options: BuildOptions, root: string): Promise<void> {
  if (selectionOf(options) === undefined) return;
  if (options.full) {
    throw new BuildError(
      'build --full y los paths seleccionados son incompatibles: --full borra la salida y la caché enteras. Quita --full para construir solo esos documentos.',
    );
  }
  if (await hasLegacyAssetLayout(options.outputDir ?? join(root, DIST_FILES_DIR))) {
    throw new BuildError(
      'la salida usa el layout de assets anterior (#2450), que exige reconstruir todo el proyecto: ejecuta `iteraciones build --full` y vuelve a pasar los paths después.',
    );
  }
}

export interface BuildSummary {
  processed: number;
  cached: number;
  formats: string[];
  outputDir: string;
  invalidations: string[];

  selected?: string[];
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
  const root = await realpath(cwd).catch(() => cwd);

  await assertSelectionCompatible(options, root);

  if (!options.full && (await hasLegacyAssetLayout(options.outputDir ?? join(root, DIST_FILES_DIR)))) {
    options.full = true;
    reporter.log('layout de assets anterior detectado en la salida (#2450) → se reconstruye la salida completa');
  }
  const pandocVersion = await getPandocVersion();

  const startedAt = performance.now();
  const progress = reporter;
  let result: BuildSummary | null = null;
  try {
    if (options.verbose) {
      result = await runBuild(root, options, progress, pandocVersion);
    } else {
      result = await runWithWarningSink(
        (message) => progress.addWarning(message),
        () => runBuild(root, options, progress, pandocVersion),
      );
    }
  } catch (err) {
    abortScriptCapture();
    await progress.fail();
    if (options.full) {
      const outputDir = options.outputDir ?? join(root, DIST_FILES_DIR);
      await rm(outputDir, { recursive: true, force: true });
    }
    throw err;
  }
  await commitScriptCapture();
  if (options.json && result !== null) {
    process.stdout.write(`${JSON.stringify({ ...result, durationMs: Math.round(performance.now() - startedAt) })}\n`);
  }
}

async function resolveEffectiveConfig(cwd: string): Promise<{ siteConfig: SiteConfig; effectiveDisabledPreamble: string[] }> {
  const siteConfig = await loadSiteConfig(cwd);
  validateDisabledFilters(siteConfig.disabledFilters);
  const effectiveDisabledPreamble = resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(siteConfig));
  validateDisabledPreambleFilters(effectiveDisabledPreamble);
  for (const issue of [...validateConfigRules(siteConfig), ...(await validateConfigFilePaths(cwd, siteConfig))]) {
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

const INVALIDATION_FLAGS: { test: (plan: BuildMetadata) => boolean; log: string; label: string }[] = [
  { test: (p) => p.filtersInvalidated, log: 'Filters modificados — reprocesando todos los documentos', label: 'filters' },
  { test: (p) => p.bibInvalidated, log: 'Bibliografía modificada — regenerando las exportaciones', label: 'bibliografía' },
  { test: (p) => p.formatInvalidated.print, log: 'Configuración PDF/LaTeX modificada — regenerando LaTeX/PDF', label: 'configuración PDF/LaTeX' },
  { test: (p) => p.formatInvalidated.html, log: 'Configuración HTML modificada — regenerando páginas HTML', label: 'configuración HTML' },
  { test: (p) => p.formatInvalidated.epub, log: 'Configuración EPUB modificada — regenerando EPUBs', label: 'configuración EPUB' },
  {
    test: (p) => p.formatInvalidated.markdown,
    log: 'Configuración Markdown modificada — regenerando exports Markdown',
    label: 'configuración Markdown',
  },
];

function logInvalidations(plan: BuildMetadata, log: (msg: string) => void): void {
  if (plan.newFormats.length > 0) {
    log(`Nuevos formatos detectados: ${plan.newFormats.join(', ')}. Generando sus salidas para todos los documentos.`);
  }
  if (plan.removedFormats.length > 0) {
    log(`Formatos eliminados: ${plan.removedFormats.join(', ')}. Limpiando archivos de dist.`);
  }
  for (const flag of INVALIDATION_FLAGS) if (flag.test(plan)) log(flag.log);
}

function collectInvalidations(plan: BuildMetadata, outputDirChanged: boolean): string[] {
  const invalidations: string[] = [];
  if (outputDirChanged) invalidations.push('directorio de salida');
  for (const flag of INVALIDATION_FLAGS) if (flag.test(plan)) invalidations.push(flag.label);
  for (const format of plan.newFormats) invalidations.push(`formato nuevo: ${format}`);
  return invalidations;
}

export async function aggregateCollectionCreators(entry: { files?: string[] }, cwd: string): Promise<string[]> {
  const aggregated = new Set<string>();
  const { with: withCreator, without: withoutCreator } = await countCreatorsByFile(entry.files ?? [], cwd);
  for (const c of withCreator) aggregated.add(c);
  addAnonymousFallback(aggregated, withoutCreator, entry.files?.length ?? 0);
  return [...aggregated].sort((a, b) => a.localeCompare(b, 'es'));
}

async function countCreatorsByFile(files: string[], cwd: string): Promise<{ with: string[]; without: number }> {
  const withCreator: string[] = [];
  let without = 0;
  for (const file of files) {
    try {
      const text = await Bun.file(join(cwd, file)).text();
      const { yaml } = splitFrontmatter(text);
      if (!yaml) {
        without++;
        continue;
      }
      const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
      if (parsed.type === 'intervention') continue;
      const creators = parseAuthors(parsed.creator);
      if (creators.length > 0) {
        withCreator.push(...creators);
      } else {
        without++;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      logWarning(`no se pudo leer el frontmatter de "${file}" para contar creadores: ${(err as Error).message}`, 'merge');
      without++;
    }
  }
  return { with: withCreator, without };
}

function addAnonymousFallback(aggregated: Set<string>, filesWithoutCreator: number, totalFiles: number): void {
  if (filesWithoutCreator === 0) return;
  if (filesWithoutCreator === totalFiles) {
    aggregated.add(totalFiles > 1 ? 'Anónimas' : 'Anónima');
  } else {
    aggregated.add('Anónima');
  }
}

export async function postProcessCollections(discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): Promise<void> {
  for (const [relativePath, entry] of discoveryIndex) {
    if (entry.type !== 'collection' || !entry.files) continue;

    const resolved: string[] = [];
    for (const file of entry.files) {
      const resolution = await resolveCollectionFile(file, relativePath, cwd);

      if (resolution.ok && discoveryIndex.get(resolution.rootRelative)?.type === 'collection') {
        throw new BuildError(
          `collection "${relativePath}": "${resolution.rootRelative}" está en su files[] y también es una collection; una collection no puede formar parte de otra. Quítalo de files[].`,
        );
      }
      resolved.push(resolution.ok ? resolution.rootRelative : file);
    }
    entry.files = resolved;
    if (entry.fm) entry.fm.files = resolved;
    entry.aggregatedCreator = await aggregateCollectionCreators(entry, cwd);
  }
}

function collectionOwnersByFile(discoveryIndex: Map<string, DiscoveryEntry>): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const [path, entry] of discoveryIndex) {
    if (entry.type !== 'collection' || !entry.files) continue;
    for (const file of entry.files) {
      const list = owners.get(file);
      if (list === undefined) owners.set(file, [path]);
      else list.push(path);
    }
  }
  return owners;
}

function expandCollectionChanges(discoveryIndex: Map<string, DiscoveryEntry>, changed: Set<string>): void {
  const owners = collectionOwnersByFile(discoveryIndex);
  const queue = [...changed];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined) break;
    for (const owner of owners.get(path) ?? []) {
      if (seen.has(owner)) continue;
      seen.add(owner);
      changed.add(owner);
      queue.push(owner);
    }
  }
}

function rootRelativeOf(raw: string, cwd: string): string {
  const unified = raw.replaceAll('\\', '/');
  const absolute = isAbsolute(unified) ? unified : join(cwd, unified);
  const rel = normalize(relative(cwd, absolute)).replaceAll('\\', '/');
  if (rel === '' || rel === '..' || rel.startsWith('../')) {
    throw new BuildError(`la ruta de build "${raw}" está fuera del proyecto (raíz del proyecto: "${cwd}")`);
  }
  return rel;
}

function resolveRequestedDoc(raw: string, cwd: string, docsByPath: Map<string, BuildDocument>): BuildDocument {
  const path = rootRelativeOf(raw, cwd);
  const doc = docsByPath.get(path);
  if (doc !== undefined) return doc;
  const candidates = [...docsByPath.keys()].filter((p) => basename(p) === basename(path)).sort();
  const hint = candidates.length > 0 ? ` — ¿quisiste decir "${candidates[0]}"?` : '';
  throw new BuildError(`no existe el documento "${raw}" en el proyecto${hint}`);
}

async function collectionClosure(doc: BuildDocument, discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): Promise<string[]> {
  const paths = [...(doc.frontmatter.files ?? [])];
  const collectionFm = discoveryIndex.get(doc.relativePath)?.fm ?? {};
  for (const creator of await resolveCollectionCreatorDocs(doc, discoveryIndex, cwd, collectionFm)) {
    paths.push(creator.relativePath);
  }
  return paths;
}

async function selectDocs(only: string[], allDocs: BuildDocument[], discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): Promise<Set<string>> {
  const docsByPath = new Map(allDocs.map((doc) => [doc.relativePath, doc]));
  const selected = new Set<string>();

  for (const raw of only) {
    const doc = resolveRequestedDoc(raw, cwd, docsByPath);
    selected.add(doc.relativePath);
    if (doc.frontmatter.type !== 'collection') continue;
    for (const path of await collectionClosure(doc, discoveryIndex, cwd)) {
      if (docsByPath.has(path)) selected.add(path);
    }
  }

  if (selected.size === 0) {
    throw new BuildError('la selección quedó vacía: ninguna de las rutas pedidas corresponde a un documento del proyecto');
  }
  return selected;
}

function restrictToSelection(
  selection: Set<string>,
  allDocs: BuildDocument[],
  discoveredChanges: Set<string>,
  slugChangedEntries: Map<string, string>,
): BuildDocument[] {
  for (const path of [...discoveredChanges]) {
    if (!selection.has(path)) discoveredChanges.delete(path);
  }

  for (const path of [...slugChangedEntries.keys()]) {
    if (!selection.has(path)) slugChangedEntries.delete(path);
  }
  return allDocs.filter((doc) => selection.has(doc.relativePath));
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

  selection: Set<string> | undefined;
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

  const { slugChangedEntries, changedPaths: slugChangedPaths } = resolveDiscoverSlugs(discoveryIndex, slugComputer);
  for (const path of slugChangedPaths) discoveredChanges.add(path);

  await postProcessCollections(discoveryIndex, cwd);

  let allDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);

  expandCollectionChanges(discoveryIndex, discoveredChanges);

  const only = selectionOf(options);
  const selection = only === undefined ? undefined : await selectDocs(only, allDocs, discoveryIndex, cwd);
  if (selection !== undefined) allDocs = restrictToSelection(selection, allDocs, discoveredChanges, slugChangedEntries);
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
  return { allDocs, discoveryIndex, discoveredChanges, deletedEntries, slugChangedEntries, pendingState, selection };
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

    selection: Set<string> | undefined;
  },
  params: {
    processedCount: number;
    cachedCount: number;
    invalidations: string[];
    empty?: boolean;

    pdfOutputs?: string[];
  },
): Promise<BuildSummary> {
  const partial = deps.selection !== undefined;
  if (deps.needsAssets) await deps.runAssets();
  const cache: PdfxCacheHandle = { prev: deps.prevPdfxCache ?? {}, out: {} };

  const pdfxScope = partial ? (params.pdfOutputs ?? []) : undefined;
  const pdfx = await runPdfxOutputValidation(deps.outputDir, deps.siteConfig, { allowBuild: true }, deps.effectiveDisabledPreamble, cache, pdfxScope);
  if (deps.pendingState) deps.pendingState.pdfxCache = cache.out;
  if (pdfx.summaryLine) deps.progress.addSummaryLine(pdfx.summaryLine);
  const formats = params.empty ? [] : computeActiveFormats(deps.siteConfig.format);

  await writeBundle(deps.cwd, deps.outputDir, deps.siteConfig);
  await deps.progress.finish(
    params.processedCount,
    params.cachedCount,
    formats,
    params.empty ? undefined : deps.outputDir,
    params.empty ? undefined : params.invalidations,
  );

  if (!partial) await persistCompletedState(deps.cwd, deps.pendingState);
  const summary: BuildSummary = {
    processed: params.processedCount,
    cached: params.cachedCount,
    formats,
    outputDir: deps.outputDir,
    invalidations: params.empty ? [] : params.invalidations,
  };

  if (deps.selection !== undefined) summary.selected = [...deps.selection].sort();
  return summary;
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
  selection?: Set<string>,
): { work: ReturnType<typeof computeWorkSets>; invalidations: string[] } {
  const outputDirChanged = prevState !== null && ctx.outputDir !== prevState.outputDir;
  if (outputDirChanged) {
    log('Directorio de salida modificado — reprocesando todos los documentos');
  }
  const work = computeWorkSets(plan, allDocs, discoveredChanges, outputDirChanged, selection);
  return { work, invalidations: collectInvalidations(plan, outputDirChanged) };
}

async function ensureCachedOutputsComplete(allDocs: BuildDocument[], work: WorkSets, activeFormats: ActiveFormats, outputDir: string): Promise<void> {
  const inWork = new Set(work.workDocList.map((d) => d.relativePath));
  const formatEntries = Object.entries(activeFormats) as [FormatKey, boolean][];

  const producible = (type: string | undefined, fmt: FormatKey): boolean => activeFormats[fmt] === true && docProducesFormat(type, fmt);

  const hasMissingOutput = async (slug: string, dir: string, type: string | undefined): Promise<boolean> => {
    for (const [fmt, active] of formatEntries) {
      if (!active || !producible(type, fmt)) continue;
      const primary = primaryOutputExtension(fmt);
      if (primary !== '' && !(await exists(join(outputDir, dir, `${slug}${primary}`)))) return true;
    }
    return false;
  };

  for (const doc of allDocs) {
    if (inWork.has(doc.relativePath)) continue;
    const slug = htmlSlugFor(doc.relativePath, doc.slug || basename(doc.relativePath, '.md'));
    const dir = dirname(doc.relativePath);
    if (!(await hasMissingOutput(slug, dir, doc.frontmatter.type))) continue;
    for (const [fmt, active] of formatEntries) {
      if (!active || !producible(doc.frontmatter.type, fmt)) continue;
      const key = FORMAT_TO_WORK[fmt];
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
): Promise<{ processedCount: number; cachedCount: number; invalidations: string[]; pdfOutputs: string[] }> {
  progress.planPhases(['discovery', 'render']);

  const workDocCount = work.workDocList.length;

  progress.startPhase('render', workDocCount);
  const { processed, pdfOutputs } = await documentPipeline(progress, ctx, plan, work, formatCfg, discoveryIndex, effectiveDisabledPreamble);

  const totalDocs =
    plan.activeFormats.html || plan.activeFormats.pdf || plan.activeFormats.epub || plan.activeFormats.markdown || plan.activeFormats.latex
      ? allDocs.length
      : 0;
  const processedCount = processed.size;
  const cachedCount = totalDocs - processedCount;
  if (invalidations.length === 0 && processedCount > 0) {
    invalidations.push(fallbackReason ?? plural(processedCount, 'documento modificado', 'documentos modificados'));
  }
  return { processedCount, cachedCount, invalidations, pdfOutputs };
}

async function runBuild(cwd: string, options: BuildOptions, progress: BuildReporter, pandocVersion: string): Promise<BuildSummary> {
  const log = (msg: string) => progress.log(msg);

  const partial = selectionOf(options) !== undefined;

  const { siteConfig, effectiveDisabledPreamble } = await resolveEffectiveConfig(cwd);

  if (siteConfig.script === true && !partial) beginScriptCapture(cwd);

  const prevState = options.full ? null : await loadStateFile(cwd);
  const plan = await computeBuildMetadata(cwd, siteConfig, prevState, effectiveDisabledPreamble, pandocVersion);
  logInvalidations(plan, log);

  const ctx = await prepareEnvironment(cwd, options, siteConfig, plan, progress);

  const { allDocs, discoveryIndex, discoveredChanges, deletedEntries, slugChangedEntries, pendingState, selection } = await discoverDocuments(
    cwd,
    options,
    plan,
    prevState,
    ctx,
    progress,
  );

  const needsAssets = ctx.needsCss;

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
    selection,
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

  const { work, invalidations } = planWork(plan, ctx, prevState, allDocs, discoveredChanges, log, selection);

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
