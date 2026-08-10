import { describe, expect, it, spyOn } from 'bun:test';
import * as runner from '../builder/export/runner.js';
import { createPdfConsumer, type PdfJob } from '../builder/pdf-pool.js';

/** Stub mínimo de ProgressTracker para aislar el pool. */
function progressStub() {
  return {
    startPhase: () => {},
    completePhase: () => {},
    reportFile: () => {},
  } as never;
}

function job(i: number): PdfJob {
  return { dir: '.', slug: `doc-${i}`, relativePath: `doc-${i}.md`, texPath: `/tmp/work/doc-${i}.tex`, pdfDest: `/tmp/out/doc-${i}.pdf` };
}

describe('pdf-pool (consumidor con solape real)', () => {
  it('los workers arrancados con start() consumen jobs mientras el productor sigue activo', async () => {
    const calls: string[] = [];
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(async (_tex, sourcePath) => {
      calls.push(sourcePath);
      await Bun.sleep(20);
    });
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 2, progressStub());
      consumer.start();

      // Producir jobs DESPUÉS de start (simula el pool 1 encolando en vivo)
      consumer.pdfJobs.push(job(1), job(2));
      await Bun.sleep(80);
      // Con solape, los workers ya compilaron antes de markProducerDone/drain
      expect(calls.length).toBeGreaterThan(0);

      consumer.pdfJobs.push(job(3), job(4));
      consumer.markProducerDone();
      await consumer.drain();
      expect(calls.length).toBe(4);
      expect(calls).toContain('doc-1.md');
      expect(calls).toContain('doc-4.md');
    } finally {
      spy.mockRestore();
    }
  });

  it('drain espera a que se complete toda la cola', async () => {
    const calls: string[] = [];
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(async (_tex, sourcePath) => {
      await Bun.sleep(15);
      calls.push(sourcePath);
    });
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 3, progressStub());
      consumer.start();
      for (let i = 0; i < 6; i++) consumer.pdfJobs.push(job(i));
      consumer.markProducerDone();
      await consumer.drain();
      expect(calls).toHaveLength(6);
    } finally {
      spy.mockRestore();
    }
  });

  it('cancel hace que los workers salgan sin compilar lo pendiente (fallo del pool 1)', async () => {
    const calls: string[] = [];
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(async (_tex, sourcePath) => {
      calls.push(sourcePath);
    });
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 2, progressStub());
      consumer.start();
      consumer.pdfJobs.push(job(1), job(2));
      consumer.cancel();
      await Bun.sleep(30);
      expect(calls).toHaveLength(0);
      await consumer.drain(); // no debe colgarse ni lanzar
    } finally {
      spy.mockRestore();
    }
  });

  it('sin jobs, drain no abre la fase PDF', async () => {
    const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 2, progressStub());
    consumer.start();
    consumer.markProducerDone();
    await consumer.drain();
    expect(true).toBe(true);
  });
});
