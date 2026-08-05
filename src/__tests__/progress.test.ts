import { describe, expect, it, spyOn } from 'bun:test';
import { ProgressTracker } from '../cli/progress.js';

/**
 * Verifica el ProgressTracker usando el TestRenderer de listr2, que emite un
 * JSON por línea con los eventos de cada tarea (STATE/OUTPUT) — sin depender
 * de terminal ni de animaciones.
 */

interface TestEvent {
  event: string;
  data: string | { output?: string; skip?: string };
  task?: { title: string; isSkipped: boolean; isCompleted: boolean };
}

async function runTracker(fn: (tracker: ProgressTracker) => Promise<void>): Promise<TestEvent[]> {
  let output = '';
  const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
  try {
    const tracker = new ProgressTracker({ renderer: 'test' });
    await fn(tracker);
    await Bun.sleep(30); // que el TestRenderer escriba los eventos finales
  } finally {
    spy.mockRestore();
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as TestEvent);
}

/** Títulos de los eventos STATE con el estado indicado. */
function titlesWith(events: TestEvent[], state: string): string[] {
  return events.filter((e) => e.event === 'STATE' && e.data === state).map((e) => e.task?.title ?? '');
}

describe('ProgressTracker', () => {
  it('registra discovery, render y las fases de formato como tareas completadas', async () => {
    const events = await runTracker(async (tracker) => {
      tracker.setFormats([{ phase: 'pdf', active: true }]);
      tracker.startPhase('discovery', 2);
      await Bun.sleep(20);
      tracker.completePhase(2);
      await tracker.planPhases(['discovery', 'render']);
      tracker.startPhase('render', 1);
      await Bun.sleep(20);
      tracker.completePhase(1);
      tracker.startPhase('pdf', 3);
      await Bun.sleep(20);
      tracker.reportFile({ relativePath: 'a.md', phase: 'pdf' });
      tracker.reportFile({ relativePath: 'b.md', phase: 'pdf' });
      tracker.reportFile({ relativePath: 'c.md', phase: 'pdf' });
      tracker.completePhase(3);
      await tracker.finish(3, 0, ['pdf']);
    });

    const completed = titlesWith(events, 'COMPLETED');
    expect(completed.some((t) => t.includes('Documentos encontrados'))).toBe(true);
    expect(completed.some((t) => t.includes('Renderizando contenido'))).toBe(true);
    expect(completed.some((t) => t.includes('PDF'))).toBe(true);
  });

  it('muestra el conteo en vivo [i/N] en el output de la tarea', async () => {
    const events = await runTracker(async (tracker) => {
      tracker.setFormats([{ phase: 'pdf', active: true }]);
      tracker.startPhase('discovery', 1);
      await Bun.sleep(20);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery']);
      tracker.startPhase('pdf', 3);
      await Bun.sleep(20);
      tracker.reportFile({ relativePath: 'a.md', phase: 'pdf' });
      tracker.reportFile({ relativePath: 'b.md', phase: 'pdf' });
      tracker.completePhase(2);
      await tracker.finish(2, 0, ['pdf']);
    });

    const outputs = events.filter((e) => e.event === 'OUTPUT').map((e) => e.data as string);
    expect(outputs).toContain('[1/3]');
    expect(outputs).toContain('[2/3]');
  });

  it('salta las fases no planificadas (render y formatos sin trabajo)', async () => {
    const events = await runTracker(async (tracker) => {
      // Sin formatos activos: el grupo 'Generando formatos' se salta completo
      tracker.setFormats([{ phase: 'pdf', active: false }]);
      tracker.startPhase('discovery', 1);
      await Bun.sleep(20);
      tracker.completePhase(1);
      // Solo discovery se planifica (early return del orquestador)
      await tracker.planPhases(['discovery']);
      await tracker.finish(1, 0, []);
    });

    const skipped = titlesWith(events, 'SKIPPED');
    expect(skipped.some((t) => t.includes('Renderizando contenido'))).toBe(true);
    expect(skipped.some((t) => t.includes('Generando formatos'))).toBe(true);
    const completed = titlesWith(events, 'COMPLETED');
    expect(completed.some((t) => t.includes('Documentos encontrados'))).toBe(true);
    // Las subtasks del padre saltado nunca se procesan
    expect(completed.some((t) => t.includes('PDF'))).toBe(false);
    expect(completed.some((t) => t.includes('Markdown'))).toBe(false);
  });

  it('no cuelga cuando finish llega antes de que el runner procese (renderer async en TTY)', async () => {
    // Regresión: en TTY el render() del DefaultRenderer es async y retrasa el
    // procesamiento del runner. Si todo el build termina antes, finish resolvía
    // un mapa vacío y las Promises registradas después colgaban run() para
    // siempre. El flag `finished` las resuelve al momento.
    const events = await runTracker(async (tracker) => {
      // Flujo sin awaits intermedios: finish llega antes de que el runner procese
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery', 'render']);
      tracker.startPhase('render', 1);
      tracker.completePhase(1);
      await tracker.finish(1, 0, []);
    });

    // El flujo completó sin colgarse; las tareas terminaron con su estado final
    const completed = titlesWith(events, 'COMPLETED');
    expect(completed.some((t) => t.includes('Documentos encontrados'))).toBe(true);
    expect(completed.some((t) => t.includes('Renderizando contenido'))).toBe(true);
  });

  it('fail resuelve las fases pendientes cuando el build falla (regresión #1211)', async () => {
    // Regresión: cuando una exportación lanza (p. ej. latexmk), la fase en curso
    // nunca se completa y run() quedaba pendiente; en TTY el render loop del
    // DefaultRenderer mantiene el proceso vivo y el build se bloqueaba tras el
    // error. fail() debe resolver las fases pendientes y esperar al runner.
    const events = await runTracker(async (tracker) => {
      tracker.setFormats([{ phase: 'pdf', active: true }]);
      tracker.startPhase('discovery', 2);
      await Bun.sleep(20);
      tracker.completePhase(2);
      await tracker.planPhases(['discovery', 'render']);
      tracker.startPhase('render', 1);
      await Bun.sleep(20);
      tracker.completePhase(1);
      tracker.startPhase('pdf', 2);
      // Simula un error de exportación: la fase pdf nunca se completa
      await tracker.fail();
    });

    const completed = titlesWith(events, 'COMPLETED');
    expect(completed.some((t) => t.includes('Documentos encontrados'))).toBe(true);
    expect(completed.some((t) => t.includes('Renderizando contenido'))).toBe(true);
    // fail resolvió la fase pendiente: el runner terminó sin colgarse
    expect(completed.some((t) => t.includes('PDF'))).toBe(true);
  });
});
