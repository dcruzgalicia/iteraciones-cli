import { join } from 'node:path';
import type { ProgressTracker } from '../cli/progress.js';
import { convertToPdf } from './export/runner.js';

export interface PdfJob {
  dir: string;
  slug: string;
  relativePath: string;
}

/**
 * Pool consumidor de compilación PDF. Corre en paralelo con el pool 1 de
 * formatos ligeros, solapando latexmk con pandoc. Cada worker toma jobs de
 * una cola compartida; el pool 1 produce y el pool 2 consume.
 */
export function createPdfConsumer(
  formatsDir: string,
  biberBase: string,
  maxSlots: number,
  progress: ProgressTracker,
): { pdfJobs: PdfJob[]; drain: () => Promise<void> } {
  const pdfJobs: PdfJob[] = [];
  let producerDone = false;
  let slot = 0;

  const drain = async (): Promise<void> => {
    producerDone = true;
    if (pdfJobs.length === 0) return;
    progress.startPhase('pdf', pdfJobs.length);

    let next = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (next < pdfJobs.length) {
          // Invariante del guard: pdfJobs[next] siempre existe
          const job = pdfJobs[next++];
          if (job === undefined) throw new Error('pdf-pool: trabajo de PDF sin definir');
          const s = slot++ % maxSlots;
          const pdfDir = join(formatsDir, 'pdf', job.dir);
          const fullTexPath = join(pdfDir, `${job.slug}.tex`);
          await convertToPdf(fullTexPath, job.relativePath, pdfDir, job.slug, join(biberBase, `cache-${s}`));
          progress.reportFile({ relativePath: job.relativePath, phase: 'pdf' });
        } else if (producerDone) {
          return;
        } else {
          await Bun.sleep(5);
        }
      }
    };
    await Promise.all(Array.from({ length: maxSlots }, () => worker()));
    progress.completePhase();
  };

  return { pdfJobs, drain };
}
