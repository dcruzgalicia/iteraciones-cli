import { dirname, join } from 'node:path';

import type { SiteConfig } from '../config/config-schema.js';
import { killInFlightProcesses, mapWithConcurrency } from '../lib/run.js';
import type { BuildMetadata, WorkSets } from './build-planner.js';
import { generateCoverImages } from './export/cover-image.js';
import { PDF_WORK_BASE } from './output-layout.js';
import { createPdfConsumer, type PdfJob } from './pdf-pool.js';
import { processDocumentFormats } from './pipeline-formats.js';
import {
  buildPoolContexts,
  type ExportContext,
  ensureBiberCaches,
  type FormatWorkSets,
  type RenderContext,
  resolvePipelineSetup,
  writeEffectiveTemplates,
} from './pipeline-setup.js';
import type { BuildContext, BuildReporter, DiscoveryEntry } from './types.js';

/**
 * Orquestador del pipeline por documento (#2176): fases nombradas y fronteras
 * explícitas. La configuración compartida y los contextos viven en
 * pipeline-setup.ts; el procesamiento por documento, en pipeline-formats.ts;
 * los helpers de I/O, en pipeline-io.ts.
 *
 * Pool 1 (formatos ligeros, concurrencia general): para cada documento, lee
 * el body del markdown una sola vez y genera cada formato activo con una
 * invocación directa de pandoc (markdown → latex/html5/epub3/markdown).
 * Encuela la compilación PDF.
 *
 * Pool 2 (PDF, slots acotados): consume la cola de jobs producida por el
 * pool 1 mientras este sigue trabajando, solapando latexmk con pandoc.
 *
 * No hay AST intermedio: cada conversión sale del markdown original.
 */

/**
 * Límite de compilaciones latexmk simultáneas del pool PDF: cada instancia
 * consume ~300-600 MB de RAM (documentado en architecture.md), así que el
 * pool tiene un tope propio, independiente de la concurrencia general, para
 * que una máquina con muchos núcleos no sature la memoria.
 */
const PDF_MAX_SLOTS = 4;

/** Número de slots del pool PDF para una concurrencia general dada. */
export function pdfSlotCount(concurrency: number): number {
  return Math.max(1, Math.min(concurrency, PDF_MAX_SLOTS));
}

/** Argumentos fijados una vez por build para el pool de formatos ligeros. */
interface LightPoolArgs {
  /** Representación única del trabajo del build (#2176): paths por formato y lista unida. */
  work: WorkSets;
  renderCtx: RenderContext;
  exportCtx: ExportContext;
  formatWorkSets: FormatWorkSets;
  discoveryIndex: Map<string, DiscoveryEntry>;
  pdfJobs: PdfJob[];
  onFatalError: () => Promise<void>;
}

/**
 * Pool 1 — ejecuta processDocumentFormats con concurrencia general y registra
 * progreso por documento. Si un documento falla se cancelan los PDFs vía
 * onFatalError y el error se propaga tras quiescer los workers.
 */
async function runLightFormatsPool(progress: BuildReporter, ctx: BuildContext, args: LightPoolArgs): Promise<{ processed: Set<string> }> {
  const processed = new Set<string>();
  progress.startLightFormats();
  try {
    await mapWithConcurrency(
      args.work.workDocList,
      ctx.concurrency,
      async (doc) => {
        await processDocumentFormats(doc, args.renderCtx, args.exportCtx, args.formatWorkSets, args.discoveryIndex);
        processed.add(doc.relativePath);
        progress.reportFile({ relativePath: doc.relativePath, phase: 'render' });
      },
      // Al fallar un documento: no más items nuevos y kill de los procesos
      // en vuelo (pandoc/latexmk) para que ningún hermano escriba en dist/
      // después del error (#2172).
      { onCancel: () => killInFlightProcesses() },
    );
  } catch (err) {
    await args.onFatalError();
    throw err;
  }
  return { processed };
}

/**
 * Ejecuta el pipeline por documento: plan resuelto y trabajo ya calculados
 * (build-planner). Fases: setup compartido → templates efectivos → pool 2
 * arrancado en paralelo → pool 1 → completado de fases → drain del pool 2 →
 * portadas PDF opcionales.
 */
export async function documentPipeline(
  progress: BuildReporter,
  ctx: BuildContext,
  plan: BuildMetadata,
  work: WorkSets,
  formatCfg: SiteConfig['format'] | undefined,
  discoveryIndex: Map<string, DiscoveryEntry>,
  /** Lista efectiva de preamble filters desactivados (la config del usuario no se muta, #2022). */
  effectiveDisabledPreamble: string[],
): Promise<{ processed: Set<string> }> {
  const { activeFormats } = plan;
  const pdfOn = activeFormats.pdf;

  // ── Configuración compartida (bibliografía, lang, logo) ──
  const setup = await resolvePipelineSetup(ctx, plan, formatCfg);

  // ── Templates efectivos (una vez por build, no dependen del documento) ──
  const templates = await writeEffectiveTemplates(ctx, plan, activeFormats.html, ctx.siteConfig, setup.bibFiles, effectiveDisabledPreamble);

  // ── Pool 2 (PDF): cachés de biber + consumidor arrancado en paralelo con el pool 1 ──
  const maxSlots = pdfOn ? pdfSlotCount(ctx.concurrency) : 0;
  if (pdfOn && maxSlots > 0) {
    await ensureBiberCaches(ctx.cwd, maxSlots);
  }
  const pdfWorkBase = join(ctx.cwd, PDF_WORK_BASE);
  const biberBase = join(ctx.cwd, '.iteraciones', 'biber');
  const pdfConsumer = createPdfConsumer(pdfWorkBase, biberBase, maxSlots, progress);
  if (pdfOn && work.exportSets.latex.length > 0) {
    // Los workers arrancan antes del pool 1: latexmk se solapa con pandoc.
    pdfConsumer.start();
  }

  // ── Contextos inmutables del pool 1 (una construcción por build, #2176) ──
  const { renderCtx, exportCtx, formatWorkSets } = await buildPoolContexts(ctx, plan, work, formatCfg, setup, templates, pdfConsumer.pdfJobs);

  // ── Pool 1 (formatos ligeros): ejecución concurrente por documento ──
  const { processed } = await runLightFormatsPool(progress, ctx, {
    work,
    renderCtx,
    exportCtx,
    formatWorkSets,
    discoveryIndex,
    pdfJobs: pdfConsumer.pdfJobs,
    // Fallo del pool 1: cancelar la cola PDF para que los workers salgan sin
    // compilar lo pendiente, ESPERAR a los que están en vuelo (#2013: un
    // latexmk vivo ejecutaría su rename hacia dist/ después del fallo) y
    // recién entonces propagar el error.
    onFatalError: async () => {
      pdfConsumer.cancel();
      await pdfConsumer.quiesce();
    },
  });

  // Pool 1 sin errores: se cierra la cola de producción del pool 2.
  pdfConsumer.markProducerDone();

  // Completar las subtareas de los formatos ligeros activos y la fase render:
  // su trabajo ocurre dentro del pool 1, así que el tracker avanza al grupo
  // 'Generando formatos' mientras los PDFs siguen compilando en el pool 2
  // (con su propio progreso en vivo).
  const count = processed.size;
  if (activeFormats.latex) progress.completePhase(count, 'latex');
  if (activeFormats.html) progress.completePhase(count, 'html');
  if (activeFormats.epub) progress.completePhase(count, 'epub');
  if (activeFormats.markdown) progress.completePhase(count, 'markdown');
  progress.completePhase(count, 'render');

  await pdfConsumer.drain();

  // Portada PDF opcional (format.pdf.cover-image): tras el vaciado del pool, la
  // imagen se extrae del PDF ya publicado en dist/ con pdftoppm. El PDF no se
  // toca: la portada es derivada y un fallo solo advierte (extra, no bloquea).
  if (pdfOn && formatCfg?.pdf?.coverImage === true) {
    await generateCoverImages(pdfConsumer.pdfJobs.map((job) => ({ pdfPath: job.pdfDest, pngPath: join(dirname(job.pdfDest), `${job.slug}.png`) })));
  }

  return { processed };
}
