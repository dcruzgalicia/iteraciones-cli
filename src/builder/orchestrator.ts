import { rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, join } from 'node:path';
import { ProgressTracker } from '../cli/progress.js';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import { computeActiveFormats } from '../config/site-config.js';
import { logInfo, logWarning } from '../lib/logger.js';
import { buildAssets } from './build-assets.js';
import { computeBuildMetadata, computeWorkSets } from './build-planner.js';
import { buildFormatsList, cleanupDeletedFiles, cleanupRemovedFormats, cleanupSlugChanges } from './cleanup.js';
import { buildDocsFromIndex, discover, htmlSlugFor } from './discover.js';
import { runDocumentPipeline } from './pipeline.js';
import { validateDisabledPreambleFilters } from './preamble-loader.js';
import { validateDisabledFilters } from './render.js';
import { clearStateFile, loadStateFile, updateCssHash } from './state.js';
import type { BuildContext } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  concurrency?: number | string;
  full?: boolean;
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
  const rawConcurrency = options.concurrency ?? defaultConcurrency;
  const concurrency = typeof rawConcurrency === 'number' ? rawConcurrency : Number.parseInt(rawConcurrency, 10);
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

export async function build(cwd: string, options: BuildOptions = {}): Promise<void> {
  if (options.dryRun) {
    await dryRun(cwd);
    return;
  }

  const progress = new ProgressTracker({
    renderer: options.verbose ? 'verbose' : 'default',
    profile: options.profile,
  });
  try {
    await runBuild(cwd, options, progress);
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
}

/**
 * Muestra los documentos que se procesarían sin generar salida.
 * Utiliza la misma lógica de invalidación que el build real
 * (mtime/size/hash, filtros, bibliografía y configuración).
 */
async function dryRun(cwd: string): Promise<void> {
  const siteConfig = await loadSiteConfig(cwd);
  const prevState = await loadStateFile(cwd);

  // Computar la metadata de invalidación igual que el build
  const plan = await computeBuildMetadata(cwd, siteConfig, prevState);

  // Descubrir documentos con el estado anterior (sin escribir state.json)
  const { relativePaths, changedPaths, discoveryIndex } = await discover(cwd, {
    prevState,
    activeFormats: plan.currentFormats,
    // El dry-run nunca persiste el estado (no genera salidas)
    persist: false,
  });
  const allDocs = buildDocsFromIndex(relativePaths, discoveryIndex, cwd);
  for (const doc of allDocs) {
    doc.slug = discoveryIndex.get(doc.relativePath)?.slug ?? basename(doc.relativePath, '.md');
  }

  const formats = computeActiveFormats(siteConfig.format);
  const formatStr = formats.length > 0 ? formats.join(', ') : '(ninguno)';
  logInfo(`Se procesarían ${allDocs.length} documentos`, 'dry-run');
  logInfo(`Formatos activos: ${formatStr}`, 'dry-run');
  if (allDocs.length === 0) return;

  // Conjuntos de trabajo reales (igual que el build)
  const work = computeWorkSets(plan, allDocs, changedPaths);
  const reprocessPaths = new Set(work.renderDocs.map((d) => d.relativePath));

  const rows = allDocs.map((doc) => {
    const status = reprocessPaths.has(doc.relativePath) ? 'se reprocesará' : 'reutilizado';
    // La salida real del HTML (index.md → index.html): el slug por título
    // (inicio) no es el nombre de archivo que se genera.
    const outputName = `${htmlSlugFor(doc.relativePath, doc.slug ?? '')}.html`;
    return { path: doc.relativePath, outputName, status };
  });

  const pathWidth = Math.max(...rows.map((r) => r.path.length), 'DOCUMENTO'.length);
  const outputWidth = Math.max(...rows.map((r) => r.outputName.length), 'SALIDA'.length);

  logInfo('');
  logInfo(`  ${'DOCUMENTO'.padEnd(pathWidth)}  ${'SALIDA'.padEnd(outputWidth)}  ESTADO`);
  for (const row of rows) {
    logInfo(`  ${row.path.padEnd(pathWidth)}  ${row.outputName.padEnd(outputWidth)}  ${row.status}`);
  }
}

async function runBuild(cwd: string, options: BuildOptions, progress: ProgressTracker): Promise<void> {
  const log = (msg: string) => progress.log(msg);

  // Cargar config primero para detectar cambios de formato antes de setupBuildEnvironment
  const siteConfig = await loadSiteConfig(cwd);
  // Validar nombres de filters desactivados (warning sin romper el build)
  validateDisabledFilters(siteConfig.disabledFilters);
  validateDisabledPreambleFilters(siteConfig.format?.pdf?.disabledPreambleFilters);

  // ── Planificación: hashes de invalidación + formatos (caché content-addressed) ──
  // Con --full no hay estado previo con qué comparar (la caché se borra en
  // setupBuildEnvironment): no cargar prevState evita mensajes de invalidación
  // engañosos y fuerza el reprocesamiento completo.
  const prevState = options.full ? null : await loadStateFile(cwd);
  const plan = await computeBuildMetadata(cwd, siteConfig, prevState);

  if (plan.newFormats.length > 0) {
    log(`Nuevos formatos detectados: ${plan.newFormats.join(', ')}. Generando sus salidas para todos los documentos.`);
  }
  if (plan.removedFormats.length > 0) {
    log(`Formatos eliminados: ${plan.removedFormats.join(', ')}. Limpiando archivos de dist.`);
  }
  if (plan.filtersInvalidated) log('Filters modificados — reprocesando todos los documentos');
  if (plan.bibInvalidated) log('Bibliografía modificada — regenerando las exportaciones');
  if (plan.formatInvalidated.pdf) log('Configuración PDF/LaTeX modificada — regenerando LaTeX/PDF');
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
  const needsAssets = plan.htmlOn;

  /** Genera assets y persiste el nuevo cssHash (solo si cambió). */
  const runAssets = async (): Promise<void> => {
    const cssHash = await buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, prevState?.cssHash);
    await updateCssHash(cwd, cssHash);
  };

  if (allDocs.length === 0) {
    // Proyecto vacío: mensaje visible en stderr (advertencias del resumen) y
    // resumen con 0 formatos (sin "reutilizado"). Exit 0: no es un error.
    logWarning('No se encontraron documentos Markdown en el proyecto.', 'build');
    logWarning("Crea un archivo .md con frontmatter o ejecuta 'iteraciones init'.", 'build');
    if (needsAssets) await runAssets();
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
    if (needsAssets) await runAssets();
    await progress.finish(
      0,
      allDocs.length,
      buildFormatsList({ latexOn: plan.latexOn, pdfOn: plan.pdfOn, htmlOn: plan.htmlOn, epubOn: plan.epubOn, mdOn: plan.mdOn }),
      ctx.outputDir,
    );
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
    if (needsAssets) await runAssets();
    await progress.finish(
      0,
      allDocs.length,
      buildFormatsList({ latexOn: plan.latexOn, pdfOn: plan.pdfOn, htmlOn: plan.htmlOn, epubOn: plan.epubOn, mdOn: plan.mdOn }),
      ctx.outputDir,
    );
    return;
  }

  // Declarar al tracker las fases que se ejecutarán (TTY: libera discovery para
  // que el tracker evalúe los skips con la información completa). Las subtareas de
  // formato se controlan por setFormats; aquí solo se declaran las fases de
  // pipeline (render se salta en early returns sin trabajo).
  await progress.planPhases(['discovery', 'render']);

  const formatCfg = siteConfig.format;

  // ── FASE 2-6: pipeline por documento (AST → formatos ligeros → .tex → PDF) ──
  const workDocCount = new Set([
    ...work.renderDocs.map((d) => d.relativePath),
    ...work.exportSets.html.map((d) => d.relativePath),
    ...work.exportSets.epub.map((d) => d.relativePath),
    ...work.exportSets.markdown.map((d) => d.relativePath),
    ...work.exportSets.pdf.map((d) => d.relativePath),
  ]).size;

  progress.startPhase('render', workDocCount);
  const { processed } = await runDocumentPipeline(progress, ctx, plan, work, formatCfg, discoveryIndex);

  // ── Build assets (css, fonts, logo) DESPUÉS de los HTML finales en dist:
  // Tailwind escanea los HTML finales de dist/files para generar el CSS exacto
  // (purga por clases presentes, sin auto-referencia del CSS previo). ──
  if (needsAssets) {
    await runAssets();
  }

  const totalDocs = plan.htmlOn || plan.pdfOn || plan.epubOn || plan.mdOn || plan.latexOn ? allDocs.length : 0;
  const processedCount = processed.size;
  const cachedCount = totalDocs - processedCount;
  await progress.finish(
    processedCount,
    cachedCount,
    buildFormatsList({ latexOn: plan.latexOn, pdfOn: plan.pdfOn, htmlOn: plan.htmlOn, epubOn: plan.epubOn, mdOn: plan.mdOn }),
    ctx.outputDir,
  );
}
