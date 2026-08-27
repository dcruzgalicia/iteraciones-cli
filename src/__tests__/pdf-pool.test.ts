import { describe, expect, it, spyOn } from 'bun:test';
import * as runner from '../builder/export/runner.js';
import { createPdfConsumer, type PdfJob } from '../builder/pdf-pool.js';
import { pdfSlotCount } from '../builder/pipeline.js';

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

describe('pdfSlotCount (tope de concurrencia del pool PDF)', () => {
  it('acota la concurrencia a PDF_MAX_SLOTS en máquinas con muchos núcleos', () => {
    expect(pdfSlotCount(32)).toBe(4);
    expect(pdfSlotCount(16)).toBe(4);
    expect(pdfSlotCount(5)).toBe(4);
  });

  it('respeta concurrencias menores sin subir el mínimo de 1', () => {
    expect(pdfSlotCount(4)).toBe(4);
    expect(pdfSlotCount(2)).toBe(2);
    expect(pdfSlotCount(1)).toBe(1);
  });
});

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
    const progress = {
      startPhase: () => {
        throw new Error('startPhase no debe llamarse sin jobs');
      },
      completePhase: () => {},
      reportFile: () => {},
    } as never;
    const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 2, progress);
    consumer.start();
    consumer.markProducerDone();
    await consumer.drain();
  });

  it('un fallo de compilación se propaga una sola vez y cancela la cola', async () => {
    const calls: string[] = [];
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(async (_tex, sourcePath) => {
      calls.push(sourcePath);
      if (sourcePath === 'doc-1.md') throw new Error('latexmk no está disponible');
      await Bun.sleep(10);
    });
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 2, progressStub());
      consumer.start();
      consumer.pdfJobs.push(job(1), job(2), job(3), job(4));
      consumer.markProducerDone();
      // drain rechaza exactamente una vez con el error original
      await expect(consumer.drain()).rejects.toThrow('latexmk no está disponible');
      // El fallo cancela la cola: los jobs pendientes nunca se compilan
      // (el job ya tomado por el otro worker puede completarse: en vuelo)
      expect(calls.length).toBeLessThan(4);
    } finally {
      spy.mockRestore();
    }
  });

  it('start es idempotente: una segunda llamada no duplica los workers', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Bun.sleep(20);
      concurrent--;
    });
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 2, progressStub());
      consumer.start();
      consumer.start();
      consumer.pdfJobs.push(job(1), job(2), job(3), job(4));
      consumer.markProducerDone();
      await consumer.drain();
      // Con start duplicado habría 4 workers y maxConcurrent llegaría a 4
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('invariante worker⇄slot: dos compilaciones concurrentes nunca comparten slot', async () => {
    // Con asignación round-robin por job (slot++ % maxSlots), un job encolado
    // mientras otro sigue en vuelo puede reutilizar el slot del primero: la
    // carrera de XMP que el issue #1967 decidió prevenir. Con workers
    // vinculados a slot fijo, la violación es estructuralmente imposible.
    const enVuelo = new Map<number, number>();
    let violacion = false;
    let liberarA!: () => void;
    const bloqueoA = new Promise<void>((r) => {
      liberarA = r;
    });
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(async (_tex, sourcePath, pdfDir) => {
      const slot = Number(/slot-(\d+)$/.exec(pdfDir)?.[1] ?? -1);
      enVuelo.set(slot, (enVuelo.get(slot) ?? 0) + 1);
      if ((enVuelo.get(slot) ?? 0) > 1) violacion = true;
      if (sourcePath === 'doc-1.md') await bloqueoA; // retiene a su worker
      await Bun.sleep(10);
      enVuelo.set(slot, (enVuelo.get(slot) ?? 1) - 1);
    });
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 2, progressStub());
      consumer.start();
      consumer.pdfJobs.push(job(1));
      await Bun.sleep(30); // worker 0 tomó doc-1 y está bloqueado en él (slot 0)
      consumer.pdfJobs.push(job(2)); // worker 1 toma doc-2 (slot 1) y termina
      await Bun.sleep(50);
      consumer.pdfJobs.push(job(3)); // worker 1 (libre) toma doc-3 mientras doc-1 sigue en vuelo
      await Bun.sleep(50);
      expect(violacion).toBe(false);
      liberarA();
      await consumer.drain();
      expect(violacion).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('cancel con job en vuelo: el job tomado termina y lo pendiente se descarta', async () => {
    const calls: string[] = [];
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(async (_tex, sourcePath) => {
      calls.push(sourcePath);
      await Bun.sleep(30);
    });
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 1, progressStub());
      consumer.start();
      consumer.pdfJobs.push(job(1), job(2), job(3));
      // Esperar a que el worker tome el primer job (único worker: secuencial)
      await Bun.sleep(10);
      consumer.cancel();
      await consumer.drain();
      // El job en vuelo (doc-1) se completó; doc-2/doc-3 nunca se compilan
      expect(calls).toEqual(['doc-1.md']);
    } finally {
      spy.mockRestore();
    }
  });

  it('drain sin markProducerDone cierra la cola defensivamente (no cuelga)', async () => {
    const calls: string[] = [];
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(async (_tex, sourcePath) => {
      calls.push(sourcePath);
    });
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 1, progressStub());
      consumer.start();
      consumer.pdfJobs.push(job(1));
      // Sin markProducerDone: drain cierra la cola y termina (el worker pudo
      // tomar el job antes del cierre — en vuelo — o no: nunca cuelga).
      await consumer.drain();
      expect(calls.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('quiesce tras cancel (#2013)', () => {
  it('espera a los workers en vuelo antes de resolver: ninguno escribe después', async () => {
    const escrituras: string[] = [];
    let liberar!: () => void;
    const enVuelo = new Promise<void>((r) => {
      liberar = r;
    });
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(async (_tex, sourcePath) => {
      if (sourcePath === 'slow.md') {
        await enVuelo;
        // El "latexmk" termina su trabajo DESPUÉS del cancel: el drenaje debe
        // haber esperado a que esta escritura (inofensiva ya) ocurriera ANTES
        // de que el proceso propague el error.
        await Bun.sleep(10);
        escrituras.push(sourcePath);
        return;
      }
      escrituras.push(sourcePath);
    });
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 2, progressStub());
      consumer.start();
      consumer.pdfJobs.push({ dir: '.', slug: 'slow', relativePath: 'slow.md', texPath: '/tmp/w/slow.tex', pdfDest: '/tmp/o/slow.pdf' });
      await Bun.sleep(20); // el worker tomó el job y está bloqueado en vuelo

      consumer.cancel();
      const quiescePromise = consumer.quiesce(2_000);
      liberar(); // el latexmk en vuelo termina
      await quiescePromise;
      // Todos los workers terminaron ANTES de que quiesce resolviera
      expect(escrituras).toContain('slow.md');
    } finally {
      spy.mockRestore();
    }
  });

  it('no cuelga si un worker se atasca: timeout de seguridad (#2013)', async () => {
    const spy = spyOn(runner, 'convertToPdf').mockImplementation(
      () =>
        new Promise<void>(() => {
          // Worker zombi: nunca resuelve
        }),
    );
    try {
      const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 1, progressStub());
      consumer.start();
      consumer.pdfJobs.push({ dir: '.', slug: 'zombi', relativePath: 'zombi.md', texPath: '/tmp/w/z.tex', pdfDest: '/tmp/o/z.pdf' });
      await Bun.sleep(20);
      consumer.cancel();
      const t0 = performance.now();
      await consumer.quiesce(50); // resuelve por timeout, sin lanzar
      expect(performance.now() - t0).toBeLessThan(5_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('quiesce sin start() es no-op', async () => {
    const consumer = createPdfConsumer('/tmp/work', '/tmp/biber', 1, progressStub());
    await consumer.quiesce();
  });
});
