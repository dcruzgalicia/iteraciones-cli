import { join } from 'node:path';
import type { ProgressTracker } from '../cli/progress.js';
import { convertToPdf } from './export/runner.js';

export interface PdfJob {
  dir: string;
  slug: string;
  relativePath: string;
  /** Ruta absoluta del .tex completo (en dist/ si latexOn, si no en el área de trabajo). */
  texPath: string;
  /** Ruta absoluta del .pdf final en dist/. */
  pdfDest: string;
}

/**
 * Pool consumidor de compilación PDF. Corre en paralelo con el pool 1 de
 * formatos ligeros, solapando latexmk con pandoc: el pool 1 encola jobs en
 * pdfJobs mientras los workers (arrancados con start() antes del pool 1)
 * los consumen.
 *
 * Ciclo de vida:
 *   start()            — arranca los workers (no espera)
 *   pdfJobs.push(...)  — el pool 1 produce (los workers consumen en vivo)
 *   markProducerDone() — el pool 1 terminó: los workers salen al vaciar la cola
 *   drain()            — espera a los workers y cierra la fase PDF
 *   cancel()           — fallo del pool 1: los workers salen sin compilar lo pendiente
 */
export function createPdfConsumer(
  pdfWorkBase: string,
  biberBase: string,
  maxSlots: number,
  progress: ProgressTracker,
): { pdfJobs: PdfJob[]; start: () => void; markProducerDone: () => void; cancel: () => void; drain: () => Promise<void> } {
  const pdfJobs: PdfJob[] = [];
  let producerDone = false;
  let next = 0;
  let slot = 0;
  let workerPromises: Promise<void>[] = [];

  const worker = async (): Promise<void> => {
    while (true) {
      if (next < pdfJobs.length) {
        // Invariante del guard: pdfJobs[next] siempre existe
        const job = pdfJobs[next++];
        if (job === undefined) throw new Error('pdf-pool: trabajo de PDF sin definir');
        const s = slot++ % maxSlots;
        // latexmk compila con -outdir en el área de trabajo (auxiliares y .pdf ahí)
        const pdfDir = join(pdfWorkBase, job.dir);
        await convertToPdf(job.texPath, job.relativePath, pdfDir, job.slug, join(biberBase, `cache-${s}`), job.pdfDest);
        progress.reportFile({ relativePath: job.relativePath, phase: 'pdf' });
      } else if (producerDone) {
        return;
      } else {
        // Productor aún activo sin jobs pendientes: esperar y volver a mirar
        await Bun.sleep(5);
      }
    }
  };

  /** Arranca los workers consumidores (antes del pool 1). No espera. */
  const start = (): void => {
    if (workerPromises.length > 0) return;
    workerPromises = Array.from({ length: maxSlots }, () => worker());
  };

  /** Marca el fin de la producción: los workers salen al vaciar la cola. */
  const markProducerDone = (): void => {
    producerDone = true;
  };

  /**
   * Cancela el trabajo pendiente (fallo del pool 1): los workers salen sin
   * compilar los jobs restantes, para que el error se propague sin dejar
   * procesos vivos que cuelguen el build.
   */
  const cancel = (): void => {
    producerDone = true;
    pdfJobs.length = 0;
  };

  /** Espera a que los workers terminen la cola y cierra la fase PDF. */
  const drain = async (): Promise<void> => {
    // Los workers consumen con next y no remueven del array: la cantidad total
    // de jobs encolados es pdfJobs.length (consumidos + pendientes). Con el
    // solape activo los workers pueden haber consumido todo antes de drain.
    const total = pdfJobs.length;
    if (total === 0) return;
    progress.startPhase('pdf', total);
    await Promise.all(workerPromises);
    progress.completePhase();
  };

  return { pdfJobs, start, markProducerDone, cancel, drain };
}
