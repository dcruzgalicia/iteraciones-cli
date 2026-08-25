import { rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import { computeActiveFormats } from '../config/site-config.js';
import { BuildError, ConfigError } from '../lib/errors.js';
import { logWarning, runWithWarningSink } from '../lib/logger.js';
import { checkPandoc } from '../lib/pandoc-runner.js';
import { buildAssets } from './build-assets.js';
import { computeBuildMetadata, computeWorkSets } from './build-planner.js';
import { cleanupCoverImages, cleanupDeletedFiles, cleanupRemovedFormats, cleanupSlugChanges } from './cleanup.js';
import { buildDocsFromIndex, discover } from './discover.js';
import { validateDisabledFilters } from './filter-resolver.js';
import { runPdfxOutputValidation } from './pdfx-check.js';
import { runDocumentPipeline } from './pipeline.js';
import { resolveEffectiveDisabledPreamble, validateDisabledPreambleFilters, validatePreambleDependencies } from './preamble-loader.js';
import { validateConfigFilePaths } from './project-validator.js';
import { silentReporter } from './reporter.js';
import { clearStateFile, loadStateFile, markStateCompleted, stateUsableForBuild, updateCssHash } from './state.js';
import type { BuildContext, BuildReporter } from './types.js';

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
  const defaultOutputDir = join(cwd, 'dist', 'files');
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
  await checkPandoc();

  const startedAt = performance.now();
  const progress = reporter;
  let result: BuildSummary | null = null;
  try {
    // En modo no verbose los warnings se difieren al resumen final del tracker
    // (en modo verbose se emiten a stderr en tiempo real). El sink se conecta
    // con runWithWarningSink: queda activo solo durante el build y se restaura
    // en un finally, sin estado global que escape de este scope.
    if (options.verbose) {
      result = await runBuild(cwd, options, progress);
    } else {
      result = await runWithWarningSink(
        (message) => progress.addWarning(message),
        () => runBuild(cwd, options, progress),
      );
    }
    // Build exitoso: el estado que persistió discover (sin flag) pasa a ser
    // válido como caché. Sin este marcado, un estado sin completed sería
    // tratado como interrumpido por el siguiente build (build completo).
    await markStateCompleted(cwd);
  } catch (err) {
    // Resolver las fases pendientes del tracker para que el proceso salga:
    // en TTY el render loop mantiene el proceso vivo mientras run() no termine
    // (regresión #1211).
    await progress.fail();
    // El estado ya persistido durante discovery puede contener documentos cuyo
    // render falló (mtime+size+hash nuevos): eliminarlo para que el siguiente
    // build los reprocese en lugar de reutilizar contenido stale u omitirlos.
    await clearStateFile(cwd);
    // Con --full, la salida se eliminó al inicio del build: si el build
    // falló a mitad, los archivos parciales de dist/ no son salidas válidas.
    // Limpiarlos evita que el siguiente build (sin --full) reutilice
    // archivos huérfanos como si fueran resultados completos.
    if (options.full) {
      const outputDir = options.outputDir ?? join(cwd, 'dist', 'files');
      await rm(outputDir, { recursive: true, force: true });
    }
    throw err;
  }
  if (options.json && result !== null) {
    process.stdout.write(`${JSON.stringify({ ...result, durationMs: Math.round(performance.now() - startedAt) })}\n`);
  }
}

async function runBuild(cwd: string, options: BuildOptions, progress: BuildReporter): Promise<BuildSummary> {
  const log = (msg: string) => progress.log(msg);

  // Cargar config primero para detectar cambios de formato antes de setupBuildEnvironment
  const siteConfig = await loadSiteConfig(cwd);
  // Validar nombres de filters desactivados (warning sin romper el build)
  validateDisabledFilters(siteConfig.disabledFilters);
  // Resolver dependencias implícitas (08-hyperref se desactiva con 99-pdfx)
  const effectiveDisabledPreamble = resolveEffectiveDisabledPreamble(siteConfig.format?.pdf?.disabledPreambleFilters);
  validateDisabledPreambleFilters(effectiveDisabledPreamble);
  // Actualizar la config con la lista efectiva para que el pipeline la use
  if (siteConfig.format?.pdf) {
    siteConfig.format.pdf.disabledPreambleFilters = effectiveDisabledPreamble;
  }
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

  // ── Planificación: hashes de invalidación + formatos (caché content-addressed) ──
  // Con --full no hay estado previo con qué comparar (la caché se borra en
  // setupBuildEnvironment): no cargar prevState evita mensajes de invalidación
  // engañosos y fuerza el reprocesamiento completo. Sin --full, solo un estado
  // con completed:true es caché válida (stateUsableForBuild): un estado de un
  // build interrumpido se ignora y se reprocesa todo.
  const prevState = options.full ? null : stateUsableForBuild(await loadStateFile(cwd));
  const plan = await computeBuildMetadata(cwd, siteConfig, prevState);

  if (plan.newFormats.length > 0) {
    log(`Nuevos formatos detectados: ${plan.newFormats.join(', ')}. Generando sus salidas para todos los documentos.`);
  }
  if (plan.removedFormats.length > 0) {
    log(`Formatos eliminados: ${plan.removedFormats.join(', ')}. Limpiando archivos de dist.`);
  }
  if (plan.filtersInvalidated) log('Filters modificados — reprocesando todos los documentos');
  if (plan.bibInvalidated) log('Bibliografía modificada — regenerando las exportaciones');
  if (plan.formatInvalidated.latex) log('Configuración PDF/LaTeX modificada — regenerando LaTeX/PDF');
  if (plan.formatInvalidated.html) log('Configuración HTML modificada — regenerando páginas HTML');
  if (plan.formatInvalidated.epub) log('Configuración EPUB modificada — regenerando EPUBs');
  if (plan.formatInvalidated.markdown) log('Configuración Markdown modificada — regenerando exports Markdown');

  if (options.full) {
    log('--full: se eliminaron la caché y la salida anterior');
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

  progress.startPhase('discovery');
  const {
    relativePaths,
    changedPaths: discoveredChanges,
    discoveryIndex,
    deletedEntries,
    slugChangedEntries,
  } = await discover(cwd, {
    full: options.full,
    activeFormats: plan.currentFormats,
    prevState,
    outputDir: ctx.outputDir,
    meta: {
      filtersHash: plan.filtersHash,
      filterFileCache: plan.filterFileCache,
      configHashes: plan.configHashes,
      bibHash: plan.bibHash,
      bibFileCache: plan.bibFileCache,
    },
  });
  const allDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);

  // El CSS se compila con HTML activo: el scan de Tailwind corre sobre los HTML
  // finales de dist/files. Con prevCssHash idéntico (ningún HTML ni recurso
  // cambió), la compilación se omite y se reutiliza el CSS existente.
  const needsAssets = plan.activeFormats.html;

  /** Genera assets y persiste el nuevo cssHash y su caché por archivo (solo si cambiaron). */
  const runAssets = async (): Promise<void> => {
    const { cssHash, cssFileCache } = await buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, prevState?.cssHash, prevState?.cssFileCache);
    await updateCssHash(cwd, cssHash, cssFileCache);
  };

  if (allDocs.length === 0) {
    // Proyecto vacío: mensaje visible en stderr (advertencias del resumen) y
    // resumen con 0 formatos (sin "reutilizado"). Exit 0: no es un error.
    logWarning('No se encontraron documentos Markdown en el proyecto.', 'build');
    logWarning("Crea un archivo .md con frontmatter o ejecuta 'iteraciones init'.", 'build');
    if (needsAssets) await runAssets();
    await progress.finish(0, 0, []);
    return { processed: 0, cached: 0, formats: [], outputDir: ctx.outputDir, invalidations: [] };
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

  // Los formatos nuevos no fuerzan re-render: cada conversión sale del
  // markdown original (pandoc-directo) y los exportSets ya incluyen todos los
  // docs vía formatInvalidated (cambia al activarse un formato).

  // ── Limpieza de dist/: archivos de formatos eliminados ──
  await cleanupRemovedFormats(ctx, allDocs, plan.removedFormats);

  // Portadas PDF huérfanas: si la opción está desactivada, se eliminan los
  // .png que quedaron de builds anteriores (activar/desactivar invalida el
  // hash del formato PDF y re-renderiza, pero nadie más borraría la imagen).
  if (plan.activeFormats.pdf && siteConfig.format?.pdf?.coverImage !== true) {
    await cleanupCoverImages(ctx, allDocs);
  }

  // ── Planificación: conjuntos de trabajo (caché content-addressed) ──
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

  // Razones de invalidación para el resumen final (modo default): las mismas
  // señales que deciden los conjuntos de trabajo, sin heurística aparte. Un
  // array vacío + trabajo real significa documentos modificados por mtime.
  const invalidations: string[] = [];
  if (outputDirChanged) invalidations.push('directorio de salida');
  if (plan.filtersInvalidated) invalidations.push('filters');
  if (plan.bibInvalidated) invalidations.push('bibliografía');
  if (plan.formatInvalidated.latex) invalidations.push('configuración PDF/LaTeX');
  if (plan.formatInvalidated.html) invalidations.push('configuración HTML');
  if (plan.formatInvalidated.epub) invalidations.push('configuración EPUB');
  if (plan.formatInvalidated.markdown) invalidations.push('configuración Markdown');
  for (const format of plan.newFormats) invalidations.push(`formato nuevo: ${format}`);

  if (!work.anyWork) {
    log('Ningún documento modificado — sin cambios');
    if (needsAssets) await runAssets();
    // Validación PDF/X-1a (fase final): los PDFs ya presentes en la salida
    // también certifican; se omite si 99-pdfx no está activo o no hay binario.
    const pdfx = await runPdfxOutputValidation(ctx.outputDir, siteConfig, { allowBuild: true });
    if (pdfx.summaryLine) progress.addSummaryLine(pdfx.summaryLine);
    const formats = computeActiveFormats(ctx.siteConfig.format);
    await progress.finish(0, allDocs.length, formats, ctx.outputDir, invalidations);
    return { processed: 0, cached: allDocs.length, formats, outputDir: ctx.outputDir, invalidations };
  }

  // Cleanup de archivos eliminados y slugs cambiados
  await cleanupDeletedFiles(ctx, discoveredChanges, allDocs, deletedEntries);
  await cleanupSlugChanges(ctx, slugChangedEntries);

  // Solo hubo eliminaciones o slugs cambiados: el cleanup ya corrió
  if (
    work.docsChanged.size === 0 &&
    work.exportSets.latex.length === 0 &&
    work.exportSets.html.length === 0 &&
    work.exportSets.epub.length === 0 &&
    work.exportSets.markdown.length === 0
  ) {
    log('Ningún documento modificado — sin cambios');
    if (needsAssets) await runAssets();
    // Validación PDF/X-1a (fase final): mismo criterio que el camino principal.
    const pdfx = await runPdfxOutputValidation(ctx.outputDir, siteConfig, { allowBuild: true });
    if (pdfx.summaryLine) progress.addSummaryLine(pdfx.summaryLine);
    const formats = computeActiveFormats(ctx.siteConfig.format);
    await progress.finish(0, allDocs.length, formats, ctx.outputDir, invalidations);
    return { processed: 0, cached: allDocs.length, formats, outputDir: ctx.outputDir, invalidations };
  }

  // Declarar al tracker las fases que se ejecutarán (TTY: libera discovery para
  // que el tracker evalúe los skips con la información completa). Las subtareas de
  // formato se controlan por setFormats; aquí solo se declaran las fases de
  // pipeline (render se salta en early returns sin trabajo).
  await progress.planPhases(['discovery', 'render']);

  const formatCfg = siteConfig.format;

  // ── Pipeline por documento: formatos ligeros + .tex/PDF encolado ──
  const workDocCount = new Set([
    ...work.docsChanged,
    ...work.exportSets.html.map((d) => d.relativePath),
    ...work.exportSets.epub.map((d) => d.relativePath),
    ...work.exportSets.markdown.map((d) => d.relativePath),
    ...work.exportSets.latex.map((d) => d.relativePath),
  ]).size;

  progress.startPhase('render', workDocCount);
  const { processed } = await runDocumentPipeline(progress, ctx, plan, work, allDocs, formatCfg, discoveryIndex);

  // ── Build assets (css, fonts, logo) DESPUÉS de los HTML finales en dist:
  // Tailwind escanea los HTML finales de dist/files para generar el CSS exacto
  // (purga por clases presentes, sin auto-referencia del CSS previo). ──
  if (needsAssets) {
    await runAssets();
  }

  // ── Validación PDF/X-1a (fase final): solo con 99-pdfx activo y PDFs en la
  // salida; el binario se resuelve (directorio gestionado → PATH → cargo) y, si
  // no se obtiene, se advierte sin romper el build (herramienta opcional). ──
  const pdfx = await runPdfxOutputValidation(ctx.outputDir, siteConfig, { allowBuild: true });
  if (pdfx.summaryLine) progress.addSummaryLine(pdfx.summaryLine);

  const totalDocs =
    plan.activeFormats.html || plan.activeFormats.pdf || plan.activeFormats.epub || plan.activeFormats.markdown || plan.activeFormats.latex
      ? allDocs.length
      : 0;
  const processedCount = processed.size;
  const cachedCount = totalDocs - processedCount;
  // Reprocesamiento por contenido (mtime/hash de fuentes) sin señal de
  // invalidación de configuración: la razón es honesta y cubre el caso común.
  if (invalidations.length === 0 && processedCount > 0) {
    invalidations.push('documentos modificados');
  }
  const formats = computeActiveFormats(ctx.siteConfig.format);
  await progress.finish(processedCount, cachedCount, formats, ctx.outputDir, invalidations);
  return { processed: processedCount, cached: cachedCount, formats, outputDir: ctx.outputDir, invalidations };
}
