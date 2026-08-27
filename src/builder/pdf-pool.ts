import { join } from 'node:path';

import { logWarning } from '../lib/logger.js';

import { convertToPdf } from './export/runner.js';
import type { BuildReporter } from './types.js';

/** Tope de espera del quiesce tras un fallo: nunca colgar el proceso. */
const QUIESCE_TIMEOUT_MS = 30_000;

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
 *
 * Contrato de errores: un fallo de compilación en cualquier worker se guarda
 * como primer error, cancela la cola (los demás workers salen sin tomar más
 * jobs) y drain() lo propaga exactamente una vez. Nunca quedan rechazos no
 * manejados: cada worker devuelve siempre, y el error viaja por `firstError`.
 */
export function createPdfConsumer(
  pdfWorkBase: string,
  biberBase: string,
  maxSlots: number,
  progress: BuildReporter,
): {
  pdfJobs: PdfJob[];
  start: () => void;
  markProducerDone: () => void;
  cancel: () => void;
  drain: () => Promise<void>;
  quiesce: (timeoutMs?: number) => Promise<void>;
} {
  const pdfJobs: PdfJob[] = [];
  let producerDone = false;
  let started = false;
  let next = 0;
  let workerPromises: Promise<void>[] = [];
  /** Primer error de compilación: se propaga una sola vez desde drain(). */
  let firstError: unknown = null;

  /** Cada worker es dueño de un slot fijo: el worker `slotIndex` compila
   * siempre en `slot-${slotIndex}` con la caché de biber `cache-${slotIndex}`.
   * Como un worker ejecuta un job cada vez, dos compilaciones concurrentes
   * nunca comparten outdir ni caché: el aislamiento es estructural, no
   * dependiente del orden de asignación.
   */
  const worker = async (slotIndex: number): Promise<void> => {
    while (true) {
      // Un fallo en cualquier worker cancela la cola: los demás salen en su
      // siguiente iteración sin compilar lo pendiente (una causa, un error).
      if (firstError !== null) return;
      if (next < pdfJobs.length) {
        // Invariante del guard: pdfJobs[next] siempre existe
        const job = pdfJobs[next++];
        if (job === undefined) {
          firstError = new Error('pdf-pool: trabajo de PDF sin definir');
          cancel();
          return;
        }
        // latexmk compila con -outdir en el área de trabajo (auxiliares y .pdf ahí).
        // El outdir se aísla por slot (una carpeta por proceso concurrente): el
        // paquete pdfx escribe un patch XMP de nombre fijo (pdfx.xmpi) en el
        // directorio de trabajo de pdflatex (== outdir), así que un outdir
        // compartido entre compilaciones paralelas provoca carreras de
        // escritura que corrompen la identificación PDF/X (issue #1967).
        // Mismo patrón de aislamiento que la caché de biber (cache-<slot>).
        const pdfDir = join(pdfWorkBase, job.dir, `slot-${slotIndex}`);
        try {
          await convertToPdf(job.texPath, job.relativePath, pdfDir, job.slug, join(biberBase, `cache-${slotIndex}`), job.pdfDest);
        } catch (err) {
          firstError = err;
          cancel();
          return;
        }
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
    if (started) return;
    started = true;
    workerPromises = Array.from({ length: maxSlots }, (_, i) => worker(i));
  };

  /** Marca el fin de la producción: los workers salen al vaciar la cola. */
  const markProducerDone = (): void => {
    producerDone = true;
  };

  /**
   * Cancela el trabajo pendiente (fallo del pool 1 o de un worker): los
   * workers salen sin compilar los jobs restantes, para que el error se
   * propague sin dejar procesos vivos que cuelguen el build.
   */
  const cancel = (): void => {
    producerDone = true;
    pdfJobs.length = 0;
  };

  /**
   * Espera a que los workers EN VUELO terminen tras un cancel() (#2013):
   * un latexmk ya compilando ejecutaría su rename final hacia dist/ después
   * de que el build haya fallado — PDF parcial o renombrado sobre un
   * directorio recién recreado con --full. Timeout de seguridad para no
   * colgar el proceso si un worker se atasca: en ese caso se procede con el
   * error original y el SO reclama al huérfano a la salida.
   */
  const quiesce = async (timeoutMs: number = QUIESCE_TIMEOUT_MS): Promise<void> => {
    if (!started || workerPromises.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(workerPromises),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('pdf-pool: workers vivos tras cancel()')), timeoutMs);
        }),
      ]);
    } catch (err) {
      logWarning(`no se pudo esperar la finalización de los workers del pool PDF: ${String(err)}`, 'pdf');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  /** Espera a que los workers terminen la cola y cierra la fase PDF. */
  const drain = async (): Promise<void> => {
    // Sin workers no hay trabajo que esperar (nunca se encoló un PDF).
    if (!started) return;
    // Contrato defensivo: si el productor nunca cerró la cola, los workers
    // harían polling para siempre. Cerrarla aquí evita el hang (el pipeline
    // real siempre llama markProducerDone o cancel antes de drain).
    if (!producerDone) cancel();
    // Los workers consumen con next y no remueven del array: la cantidad total
    // de jobs encolados es pdfJobs.length (consumidos + pendientes). Con el
    // solape activo los workers pueden haber consumido todo antes de drain.
    const total = pdfJobs.length;
    if (total > 0 && firstError === null) {
      progress.startPhase('pdf', total);
    }
    // Esperar a todos los workers (incluidos los que salen por cancelación):
    // un error nunca puede dejar rechazos no manejados que el runtime imprima.
    await Promise.all(workerPromises);
    if (total > 0 && firstError === null) {
      progress.completePhase();
    }
    if (firstError !== null) {
      // El error original (p. ej. PandocError con sourcePath) se propaga una
      // sola vez; la fase PDF queda activa para que el tracker la marque como
      // fallida (✖) en fail().
      throw firstError;
    }
  };

  return { pdfJobs, start, markProducerDone, cancel, drain, quiesce };
}
