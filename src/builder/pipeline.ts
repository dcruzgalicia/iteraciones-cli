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

const PDF_MAX_SLOTS = 4;

export function pdfSlotCount(concurrency: number): number {
  return Math.max(1, Math.min(concurrency, PDF_MAX_SLOTS));
}

interface LightPoolArgs {
  work: WorkSets;
  renderCtx: RenderContext;
  exportCtx: ExportContext;
  formatWorkSets: FormatWorkSets;
  discoveryIndex: Map<string, DiscoveryEntry>;
  pdfJobs: PdfJob[];
  onFatalError: () => Promise<void>;
}

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
      { onCancel: () => killInFlightProcesses() },
    );
  } catch (err) {
    await args.onFatalError();
    throw err;
  }
  return { processed };
}

export async function documentPipeline(
  progress: BuildReporter,
  ctx: BuildContext,
  plan: BuildMetadata,
  work: WorkSets,
  formatCfg: SiteConfig['format'] | undefined,
  discoveryIndex: Map<string, DiscoveryEntry>,
  effectiveDisabledPreamble: string[],
): Promise<{ processed: Set<string> }> {
  const { activeFormats } = plan;
  const pdfOn = activeFormats.pdf;

  const setup = await resolvePipelineSetup(ctx, plan, formatCfg);

  const templates = await writeEffectiveTemplates(ctx, plan, activeFormats.html, ctx.siteConfig, setup.bibFiles, effectiveDisabledPreamble);

  const maxSlots = pdfOn ? pdfSlotCount(ctx.concurrency) : 0;
  if (pdfOn) {
    await ensureBiberCaches(ctx.cwd, maxSlots);
  }
  const pdfWorkBase = join(ctx.cwd, PDF_WORK_BASE);
  const biberBase = join(ctx.cwd, '.iteraciones', 'biber');
  const pdfConsumer = createPdfConsumer(pdfWorkBase, biberBase, maxSlots, progress);
  if (pdfOn && work.exportSets.print.length > 0) {
    pdfConsumer.start();
  }

  const { renderCtx, exportCtx, formatWorkSets } = await buildPoolContexts(ctx, plan, work, formatCfg, setup, templates, pdfConsumer.pdfJobs);

  const { processed } = await runLightFormatsPool(progress, ctx, {
    work,
    renderCtx,
    exportCtx,
    formatWorkSets,
    discoveryIndex,
    pdfJobs: pdfConsumer.pdfJobs,
    onFatalError: async () => {
      pdfConsumer.cancel();
      await pdfConsumer.quiesce();
    },
  });

  pdfConsumer.markProducerDone();

  const count = processed.size;
  if (activeFormats.latex) progress.completePhase(count, 'latex');
  if (activeFormats.html) progress.completePhase(count, 'html');
  if (activeFormats.epub) progress.completePhase(count, 'epub');
  if (activeFormats.markdown) progress.completePhase(count, 'markdown');
  progress.completePhase(count, 'render');

  await pdfConsumer.drain();

  if (pdfOn && formatCfg?.pdf?.coverImage === true) {
    await generateCoverImages(pdfConsumer.pdfJobs.map((job) => ({ pdfPath: job.pdfDest, pngPath: join(dirname(job.pdfDest), `${job.slug}.png`) })));
  }

  return { processed };
}
