import { join } from 'node:path';

import { logWarning } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { killProcessTree } from '../lib/run.js';
import { convertToPdf } from './export/runner.js';
import type { BuildReporter } from './types.js';

const QUIESCE_TIMEOUT_MS = 30_000;

const QUIESCE_KILL_GRACE_MS = 2_000;

export interface PdfJob {
  dir: string;
  slug: string;
  relativePath: string;
  texPath: string;
  pdfDest: string;
  cover: boolean;
}

function raceWithTimeout(promises: Promise<void>[], ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pdf-pool: workers vivos tras cancel()')), ms);
    void Promise.allSettled(promises)
      .then(() => resolve())
      .finally(() => clearTimeout(timer));
  });
}

async function waitForWorkers(promises: Promise<void>[], timeoutMs: number): Promise<boolean> {
  try {
    await raceWithTimeout(promises, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

async function executePdfJob(
  job: PdfJob,
  slotIndex: number,
  pdfWorkBase: string,
  biberBase: string,
  inFlightPids: (number | null)[],
  progress: BuildReporter,
  onError: (err: unknown) => void,
): Promise<boolean> {
  const pdfDir = join(pdfWorkBase, job.dir, `slot-${slotIndex}`);
  try {
    await convertToPdf(job.texPath, job.relativePath, pdfDir, job.slug, join(biberBase, `cache-${slotIndex}`), job.pdfDest, (pid) => {
      inFlightPids[slotIndex] = pid;
    });
  } catch (err) {
    onError(err);
    return false;
  } finally {
    inFlightPids[slotIndex] = null;
  }
  progress.reportFile({ relativePath: job.relativePath, phase: 'pdf' });
  return true;
}

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
  let firstError: unknown = null;
  let pdfPhaseStarted = false;
  const inFlightPids: (number | null)[] = Array.from({ length: maxSlots }, () => null);

  const onError = (err: unknown): void => {
    firstError = err;
    producerDone = true;
    pdfJobs.length = 0;
  };

  const worker = async (slotIndex: number): Promise<void> => {
    while (firstError === null) {
      if (next >= pdfJobs.length) {
        if (producerDone) return;
        await Bun.sleep(5);
        continue;
      }
      const job = pdfJobs[next++];
      if (job === undefined) continue;
      ensurePdfPhaseStarted();
      const ok = await executePdfJob(job, slotIndex, pdfWorkBase, biberBase, inFlightPids, progress, onError);
      if (!ok) return;
    }
  };

  const ensurePdfPhaseStarted = (): void => {
    if (!pdfPhaseStarted) {
      pdfPhaseStarted = true;
      progress.startPhase('pdf', 0);
    }
  };

  const start = (): void => {
    if (started) return;
    started = true;
    workerPromises = Array.from({ length: maxSlots }, (_, i) => worker(i));
  };

  const markProducerDone = (): void => {
    producerDone = true;
  };

  const cancel = (): void => {
    producerDone = true;
    pdfJobs.length = 0;
  };

  const quiesce = async (timeoutMs: number = QUIESCE_TIMEOUT_MS): Promise<void> => {
    if (!started || workerPromises.length === 0) return;
    if (await waitForWorkers(workerPromises, timeoutMs)) return;
    const pids = inFlightPids.filter((pid): pid is number => pid !== null);
    if (pids.length === 0) return;
    logWarning(`terminando ${plural(pids.length, 'compilación PDF en vuelo', 'compilaciones PDF en vuelo')} tras el fallo del build`, 'pdf');
    await Promise.all(pids.map((pid) => killProcessTree(pid)));
    await waitForWorkers(workerPromises, QUIESCE_KILL_GRACE_MS).catch((err) => {
      logWarning(`no se pudo esperar la finalización de los workers del pool PDF: ${String(err)}`, 'pdf');
    });
  };

  const drain = async (): Promise<void> => {
    if (!started) return;
    if (!producerDone) cancel();
    const total = pdfJobs.length;
    const noWorkYet = total > 0 && firstError === null && !pdfPhaseStarted;
    if (noWorkYet) progress.startPhase('pdf', total);
    await Promise.all(workerPromises);
    if (total > 0 && firstError === null) progress.completePhase(total, 'pdf');
    if (firstError !== null) throw firstError;
  };

  return { pdfJobs, start, markProducerDone, cancel, drain, quiesce };
}
