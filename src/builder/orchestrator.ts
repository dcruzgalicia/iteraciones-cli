import { rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import { computeActiveFormats } from '../config/site-config.js';
import { BuildError, ConfigError } from '../lib/errors.js';
import { logWarning, runWithWarningSink } from '../lib/logger.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { plural } from '../lib/plural.js';
import { buildAssets } from './build-assets.js';
import { type BuildMetadata, computeBuildMetadata, computeWorkSets } from './build-planner.js';
import { cleanupCoverImages, cleanupDeletedFiles, cleanupRemovedFormats, cleanupSlugChanges } from './cleanup.js';
import { buildDocsFromIndex, discover, loadPrevState, noPrevState } from './discover.js';
import { validateDisabledFilters } from './filter-resolver.js';
import { DIST_FILES_DIR } from './output-layout.js';
import { runPdfxOutputValidation } from './pdfx-check.js';
import { documentPipeline } from './pipeline.js';
import { resolveEffectiveDisabledPreamble, validateDisabledPreambleFilters, validatePreambleDependencies } from './preamble-loader.js';
import { validateConfigFilePaths } from './project-validator.js';
import { silentReporter } from './reporter.js';
import type { BuildState } from './state.js';
import { persistCompletedState } from './state-serialize.js';
import type { BuildContext, BuildDocument, BuildReporter, DiscoveryEntry } from './types.js';

/**
 * Advertencias autosuficientes de proyecto vacío (#2074): únicas fuente de los
 * literales que emite el build y que el resumen del tracker usa para decidir
 * si añade la guía genérica "ejecuta 'iteraciones validate'" (validate no
 * aporta en un proyecto vacío). Cambiar aquí cambia también el filtro.
 */
export const EMPTY_PROJECT_WARNING_NO_DOCS = 'No se encontraron documentos Markdown en el proyecto.';
export const EMPTY_PROJECT_WARNING_INIT = "Crea un archivo .md con frontmatter o ejecuta 'iteraciones init'.";

export interface BuildOptions {
  outputDir?: string;
  full?: boolean;
  verbose?: boolean;
  /** Salida JSON del resultado en stdout (consumo programático). Mutuamente exclusivo con --verbose. */
  json?: boolean;
}

/** Resultado del build para consumo programático (--json). Contrato en docs/architecture.md. */
export interface BuildSummary {
  processed: number;
  cached: number;
  formats: string[];
  outputDir: string;
  invalidations: string[];
}

async function setupBuildEnvironment(cwd: string, siteConfig: SiteConfig, options: BuildOptions): Promise<BuildContext> {
  const defaultOutputDir = join(cwd, DIST_FILES_DIR);
  // Límite superior de 16: en máquinas con muchos núcleos, demasiados procesos
  // simultáneos saturan el sistema de archivos y degradan el rendimiento.
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
  // Verificar pandoc al inicio: si no está en PATH, el error es inmediato y
  // accionable en lugar de un ENOENT técnico en la primera invocación.
  const pandocVersion = await getPandocVersion();

  const startedAt = performance.now();
  const progress = reporter;
  let result: BuildSummary | null = null;
  try {
    // En modo no verbose los warnings se difieren al resumen final del tracker
    // (en modo verbose se emiten a stderr en tiempo real). El sink se conecta
    // con runWithWarningSink: queda activo solo durante el build y se restaura
    // en un finally, sin estado global que escape de este scope.
    if (options.verbose) {
      result = await runBuild(cwd, options, progress, pandocVersion);
    } else {
      result = await runWithWarningSink(
        (message) => progress.addWarning(message),
        () => runBuild(cwd, options, progress, pandocVersion),
      );
    }
  } catch (err) {
    // Resolver las fases pendientes del tracker para que el proceso salga:
    // en TTY el render loop mantiene el proceso vivo mientras run() no termine
    // (regresión #1211).
    await progress.fail();
    // El estado NO se borra ante un fallo (#2168): desde #2025 state.json se
    // escribe UNA sola vez, en el cierre, y siempre con completed:true
    // (stateUsableForBuild) — cualquier state.json en disco es el de un build
    // completo, último estado conocido bueno. El discovery content-addressed
    // del siguiente build re-detecta los cambios contra él: borrarlo
    // castigaría con un rebuild completo incluso a errores de config previos
    // a discovery. Con --full, en cambio, la salida se eliminó al inicio:
    // los archivos parciales de dist/ no son salidas válidas y se limpian.
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

/**
 * Config efectiva sin mutar el objeto del usuario (issue #2022): la lista
 * efectiva de preamble filters viaja como valor explícito hasta pipeline,
 * pdfx y hashing; `siteConfig` permanece intacto.
 */
async function resolveEffectiveConfig(cwd: string): Promise<{ siteConfig: SiteConfig; effectiveDisabledPreamble: string[] }> {
  const siteConfig = await loadSiteConfig(cwd);
  // Validar nombres de filters desactivados (warning sin romper el build)
  validateDisabledFilters(siteConfig.disabledFilters);
  // Resolver dependencias implícitas (08-hyperref se desactiva con 99-pdfx)
  const effectiveDisabledPreamble = resolveEffectiveDisabledPreamble(siteConfig.format?.pdf?.disabledPreambleFilters);
  validateDisabledPreambleFilters(effectiveDisabledPreamble);
  // Rutas configuradas (bibliography/csl): inexistentes son error de config,
  // mismo contrato que validate (módulo project-validator); lua-filters
  // inexistentes se advierten y se omiten.
  for (const issue of await validateConfigFilePaths(cwd, siteConfig)) {
    if (issue.severity === 'error') {
      throw new ConfigError(`iteraciones.config.yaml: ${issue.message}`, join(cwd, 'iteraciones.config.yaml'));
    }
    logWarning(`iteraciones.config.yaml: ${issue.message}`, 'config');
  }
  // Dependencias entre preamble filters: errores bloqueantes, warnings visibles
  for (const issue of validatePreambleDependencies(effectiveDisabledPreamble)) {
    if (issue.severity === 'error') {
      throw new BuildError(`dependencia de preamble filters: ${issue.message}`);
    }
    logWarning(issue.message, 'config');
  }
  return { siteConfig, effectiveDisabledPreamble };
}

/** Fuente única de los mensajes de invalidación temprana (mismo orden histórico). */
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

/** Fuente única del array de invalidaciones del resumen (--json incluido). */
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

/**
 * Fase de discovery: escanea documentos, reporta filas en verbose, asigna
 * slugs desde el índice y completa la fase (#2022).
 */
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
    slugChangedEntries,
    pendingState,
  } = await discover(cwd, {
    full: options.full,
    activeFormats: plan.currentFormats,
    prevState,
    outputDir: ctx.outputDir,
    meta: {
      filtersHash: plan.filtersHash,
      filterFileCache: plan.filterFileCache,
      configHashes: plan.configHashes,
      configFileCache: plan.configFileCache,
      bibHash: plan.bibHash,
      bibFileCache: plan.bibFileCache,
    },
  });
  const allDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);
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

/**
 * Cierre común de TODO build (issue #2019): assets + validación PDF/X +
 * cómputo de formatos + resumen. Un único final garantiza que un fix futuro
 * no toque dos de tres ramas. Las sutilezas de conteo por rama entran como
 * parámetros; el proyecto vacío usa modo `empty` (formatos [] y sin líneas
 * de salida/invalidación en el resumen, como siempre).
 */
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
  },
  params: { processedCount: number; cachedCount: number; invalidations: string[]; empty?: boolean },
): Promise<BuildSummary> {
  if (deps.needsAssets) await deps.runAssets();
  // Validación PDF/X-1a (fase final): los PDFs ya presentes en la salida
  // también certifican; se omite si 99-pdfx no está activo o no hay binario.
  const pdfx = await runPdfxOutputValidation(deps.outputDir, deps.siteConfig, { allowBuild: true }, deps.effectiveDisabledPreamble);
  if (pdfx.summaryLine) deps.progress.addSummaryLine(pdfx.summaryLine);
  const formats = params.empty ? [] : computeActiveFormats(deps.siteConfig.format);
  await deps.progress.finish(
    params.processedCount,
    params.cachedCount,
    formats,
    params.empty ? undefined : deps.outputDir,
    params.empty ? undefined : params.invalidations,
  );
  // ÚNICA escritura de state.json por build (#2025): en el cierre común,
  // con el índice de discovery y el cssHash ya acumulados en memoria.
  await persistCompletedState(deps.cwd, deps.pendingState);
  return {
    processed: params.processedCount,
    cached: params.cachedCount,
    formats,
    outputDir: deps.outputDir,
    invalidations: params.empty ? [] : params.invalidations,
  };
}

/**
 * Prepara el entorno del build: mensajes de --full, directorio de salida,
 * señal de CSS y declaración de los cinco formatos en el tracker (#2022).
 */
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
  // Los 5 formatos configurados se muestran siempre en el tracker: activos con
  // ✔ (su trabajo se completa en el pipeline), desactivados con – (omitidos).
  progress.setFormats([
    { phase: 'latex', active: plan.activeFormats.latex },
    { phase: 'pdf', active: plan.activeFormats.pdf },
    { phase: 'html', active: plan.activeFormats.html },
    { phase: 'epub', active: plan.activeFormats.epub },
    { phase: 'markdown', active: plan.activeFormats.markdown },
  ]);
  return ctx;
}

/** Limpieza de dist/ por cambios de formatos y portadas huérfanas (#2012). Devuelve archivos eliminados. */
async function formatCleanup(ctx: BuildContext, plan: BuildMetadata, allDocs: BuildDocument[], siteConfig: SiteConfig): Promise<number> {
  let removed = await cleanupRemovedFormats(ctx, allDocs, plan.removedFormats);
  // Portadas PDF huérfanas: si la opción está desactivada, se eliminan los
  // .png que quedaron de builds anteriores (activar/desactivar invalida el
  // hash del formato PDF y re-renderiza, pero nadie más borraría la imagen).
  if (plan.activeFormats.pdf && siteConfig.format?.pdf?.coverImage !== true) {
    removed += await cleanupCoverImages(ctx, allDocs);
  }
  return removed;
}

/** Conjuntos de trabajo + razones de invalidación (fuente única, #2022). */
function planWork(
  plan: BuildMetadata,
  ctx: BuildContext,
  prevState: BuildState | null,
  allDocs: BuildDocument[],
  discoveredChanges: Set<string>,
  log: (msg: string) => void,
): { work: ReturnType<typeof computeWorkSets>; invalidations: string[] } {
  // Un cambio del directorio de salida (--output) entre builds fuerza el
  // reprocesamiento completo: la caché vivía en el directorio anterior y los
  // documentos deben regenerarse donde se pide ahora (y al volver al default,
  // regenerar dist/files). discover ya persiste outputDir en el estado; esta
  // comparación propaga la señal al cálculo de trabajo.
  const outputDirChanged = prevState !== null && ctx.outputDir !== prevState.outputDir;
  if (outputDirChanged) {
    log('Directorio de salida modificado — reprocesando todos los documentos');
  }
  const work = computeWorkSets(plan, allDocs, discoveredChanges, outputDirChanged);
  return { work, invalidations: collectInvalidations(plan, outputDirChanged) };
}

/** Fase de pipeline por documento: planificación de fases, ejecución y conteos finales. */
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
  /** Razón explícita cuando no hay invalidación de config: primera build o --full (#2181). */
  fallbackReason: string | null,
): Promise<{ processedCount: number; cachedCount: number; invalidations: string[] }> {
  // Declarar al tracker las fases que se ejecutarán (TTY: libera discovery para
  // que el tracker evalúe los skips con la información completa). Las subtareas de
  // formato se controlan por setFormats; aquí solo se declaran las fases de
  // pipeline (render se salta en early returns sin trabajo).
  progress.planPhases(['discovery', 'render']);

  // Representación única del trabajo (#2176): la unión la calculó el planner
  const workDocCount = work.workDocList.length;

  progress.startPhase('render', workDocCount);
  const { processed } = await documentPipeline(progress, ctx, plan, work, formatCfg, discoveryIndex, effectiveDisabledPreamble);

  const totalDocs =
    plan.activeFormats.html || plan.activeFormats.pdf || plan.activeFormats.epub || plan.activeFormats.markdown || plan.activeFormats.latex
      ? allDocs.length
      : 0;
  const processedCount = processed.size;
  const cachedCount = totalDocs - processedCount;
  // Reprocesamiento por contenido (mtime/hash de fuentes) sin señal de
  // invalidación de configuración: la razón es honesta — «primera build» o
  // «build completo desde cero» cuando no hay estado previo contra el que
  // comparar (nada estaba "modificado"), y con plural correcto en incremental.
  if (invalidations.length === 0 && processedCount > 0) {
    invalidations.push(fallbackReason ?? plural(processedCount, 'documento modificado', 'documentos modificados'));
  }
  return { processedCount, cachedCount, invalidations };
}

async function runBuild(cwd: string, options: BuildOptions, progress: BuildReporter, pandocVersion: string): Promise<BuildSummary> {
  const log = (msg: string) => progress.log(msg);

  // Cargar config primero para detectar cambios de formato antes de setupBuildEnvironment
  const { siteConfig, effectiveDisabledPreamble } = await resolveEffectiveConfig(cwd);

  // ── Planificación: hashes de invalidación + formatos (caché content-addressed) ──
  // Con --full no hay estado previo con qué comparar (la caché se borra en
  // setupBuildEnvironment): no cargar prevState evita mensajes de invalidación
  // engañosos y fuerza el reprocesamiento completo. Sin --full, solo un estado
  // con completed:true es caché válida (stateUsableForBuild): un estado de un
  // build interrumpido se ignora y se reprocesa todo.
  const prevState = options.full ? noPrevState() : await loadPrevState(cwd);
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

  // El CSS se compila con HTML activo: el scan de Tailwind corre sobre los HTML
  // finales de dist/files. Con prevCssHash idéntico (ningún HTML ni recurso
  // cambió), la compilación se omite y se reutiliza el CSS existente.
  const needsAssets = plan.activeFormats.html;

  /**
   * Genera assets y ACUMULA el nuevo cssHash/caché en el estado pendiente
   * (#2025): nada escribe aquí — la única escritura ocurre en el cierre.
   * Sin estado pendiente (build sin cambios) los valores no se acumulan:
   * el disco conserva los vigentes.
   */
  const runAssets = async (): Promise<void> => {
    const { cssHash, cssFileCache } = await buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, prevState?.cssHash, prevState?.cssFileCache);
    if (pendingState) {
      pendingState.cssHash = cssHash;
      if (cssFileCache !== undefined) pendingState.cssFileCache = cssFileCache;
    }
  };

  // Dependencias del cierre común (#2076): los valores son estables tras
  // prepareEnvironment; se construyen una vez para las 4 invocaciones.
  const closeDeps = { progress, siteConfig, outputDir: ctx.outputDir, effectiveDisabledPreamble, needsAssets, runAssets, cwd, pendingState };

  if (allDocs.length === 0) {
    // Proyecto vacío: mensaje visible en stderr (advertencias del resumen) y
    // resumen con 0 formatos (sin "reutilizado"). Exit 0: no es un error.
    logWarning(EMPTY_PROJECT_WARNING_NO_DOCS, 'build');
    logWarning(EMPTY_PROJECT_WARNING_INIT, 'build');
    return finishBuild(closeDeps, {
      processedCount: 0,
      cachedCount: 0,
      invalidations: [],
      empty: true,
    });
  }

  // Los formatos nuevos no fuerzan re-render: cada conversión sale del
  // markdown original (pandoc-directo) y los exportSets ya incluyen todos los
  // docs vía formatInvalidated (cambia al activarse un formato).

  let cleanedFiles = await formatCleanup(ctx, plan, allDocs, siteConfig);

  const { work, invalidations } = planWork(plan, ctx, prevState, allDocs, discoveredChanges, log);

  if (!work.anyWork) {
    log('Ningún documento modificado — sin cambios');
    return finishBuild(closeDeps, {
      processedCount: 0,
      cachedCount: allDocs.length,
      invalidations,
    });
  }

  // Cleanup de archivos eliminados y slugs cambiados
  cleanedFiles += await cleanupDeletedFiles(ctx, discoveredChanges, allDocs, deletedEntries);
  cleanedFiles += await cleanupSlugChanges(ctx, slugChangedEntries);
  // Informe en UNA línea del tracker (#2012)
  if (cleanedFiles > 0) {
    log(`Limpieza de dist: ${plural(cleanedFiles, 'archivo residual eliminado', 'archivos residuales eliminados')}.`);
  }

  // Solo hubo eliminaciones o slugs cambiados: el cleanup ya corrió
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

  // Sin estado previo no hay nada "modificado": la razón describe el origen
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
