import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { ProgressTracker } from '../cli/progress.js';
import { setWarningSink } from '../lib/logger.js';

/**
 * Verifica el ProgressTracker con el renderer propio: captura la salida de
 * stdout y permite asertar sobre las líneas de estado finales (non-TTY).
 */

async function runTracker(
  fn: (tracker: ProgressTracker) => Promise<void>,
  options: { renderer?: 'default' | 'verbose' | 'test'; tty?: boolean } = {},
): Promise<string> {
  let output = '';
  const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
  const origTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  try {
    if (options.tty) {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    }
    const tracker = new ProgressTracker({ renderer: options.renderer ?? 'test' });
    await fn(tracker);
  } finally {
    // Un tracker con renderer 'default' activa el warningSink; el test de
    // re-escritura TTY nunca llama a finish()/fail(), así que el sink debe
    // limpiarse aquí para no contaminar los tests posteriores (suite hermética).
    setWarningSink(null);
    if (origTty) Object.defineProperty(process.stdout, 'isTTY', origTty);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    spy.mockRestore();
  }
  return output;
}

describe('ProgressTracker', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it('registra discovery, render y las fases de formato como completadas', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.setFormats([{ phase: 'pdf', active: true }]);
      tracker.startPhase('discovery', 2);
      tracker.completePhase(2);
      await tracker.planPhases(['discovery', 'render']);
      tracker.startPhase('render', 1);
      tracker.completePhase(1);
      tracker.startPhase('pdf', 3);
      tracker.reportFile({ relativePath: 'a.md', phase: 'pdf' });
      tracker.completePhase(3);
      await tracker.finish(3, 0, ['pdf']);
    });

    expect(output).toContain('✔ Documentos encontrados 2');
    expect(output).toContain('✔ Renderizando contenido 1');
    expect(output).toContain('✔ PDF 3');
    expect(output).toContain('✔ Generando formatos');
  });

  it('muestra el conteo en vivo [i/N] en TTY', async () => {
    const output = await runTracker(
      async (tracker) => {
        tracker.setFormats([{ phase: 'pdf', active: true }]);
        tracker.startPhase('discovery', 1);
        tracker.completePhase(1);
        await tracker.planPhases(['discovery']);
        tracker.startPhase('pdf', 3);
        tracker.reportFile({ relativePath: 'a.md', phase: 'pdf' });
        tracker.reportFile({ relativePath: 'b.md', phase: 'pdf' });
        tracker.completePhase(2);
        await tracker.finish(2, 0, ['pdf']);
      },
      { renderer: 'default', tty: true },
    );

    expect(output).toContain('[1/3]');
    expect(output).toContain('[2/3]');
  });

  it('salta las fases no planificadas (render y formatos sin trabajo)', async () => {
    const output = await runTracker(async (tracker) => {
      // Sin formatos activos: el grupo 'Generando formatos' se omite completo
      tracker.setFormats([{ phase: 'pdf', active: false }]);
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      // Solo discovery se planifica (early return del orquestador)
      await tracker.planPhases(['discovery']);
      await tracker.finish(1, 0, []);
    });

    expect(output).toContain('✔ Documentos encontrados 1');
    expect(output).toContain('– Renderizando contenido');
    expect(output).not.toContain('Generando formatos');
    expect(output).not.toContain('✔ PDF');
    expect(output).not.toContain('✔ Markdown');
  });

  it('muestra los formatos desactivados con su estado', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.setFormats([
        { phase: 'pdf', active: true },
        { phase: 'html', active: false },
      ]);
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery']);
      await tracker.finish(0, 1, ['pdf']);
    });

    expect(output).toContain('✔ Generando formatos');
    expect(output).toContain('– HTML (desactivado)');
  });

  it('no cuelga cuando finish llega antes de que las fases se procesen', async () => {
    // Regresión #1211: el render loop del renderer anterior podía mantener el
    // proceso vivo. El renderer propio es síncrono: el flujo siempre completa.
    const output = await runTracker(async (tracker) => {
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery', 'render']);
      tracker.startPhase('render', 1);
      tracker.completePhase(1);
      await tracker.finish(1, 0, []);
    });

    expect(output).toContain('✔ Documentos encontrados 1');
    expect(output).toContain('✔ Renderizando contenido 1');
  });

  it('fail cierra las fases pendientes sin colgarse cuando el build falla (regresión #1211)', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.setFormats([{ phase: 'pdf', active: true }]);
      tracker.startPhase('discovery', 2);
      tracker.completePhase(2);
      await tracker.planPhases(['discovery', 'render']);
      tracker.startPhase('render', 1);
      tracker.completePhase(1);
      tracker.startPhase('pdf', 2);
      // Simula un error de exportación: la fase pdf nunca se completa
      await tracker.fail();
    });

    expect(output).toContain('✔ Documentos encontrados 2');
    expect(output).toContain('✔ Renderizando contenido 1');
  });

  it('marca la fase activa como fallida (✖) cuando el build falla', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.setFormats([{ phase: 'pdf', active: true }]);
      tracker.startPhase('discovery', 2);
      tracker.completePhase(2);
      await tracker.planPhases(['discovery', 'render']);
      tracker.startPhase('render', 1);
      tracker.completePhase(1);
      tracker.startPhase('pdf', 2);
      await tracker.fail();
    });

    expect(output).toContain('✖ PDF');
    expect(output).not.toContain('✔ PDF');
    // Las fases completadas antes del fallo conservan su estado real
    expect(output).toContain('✔ Renderizando contenido 1');
  });

  it('un fallo en render no muestra éxito en fases posteriores no ejecutadas', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.setFormats([
        { phase: 'pdf', active: true },
        { phase: 'html', active: true },
      ]);
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery', 'render']);
      tracker.startPhase('render', 1);
      await tracker.fail();
    });

    expect(output).toContain('✖ Renderizando contenido');
    expect(output).not.toContain('✔ Renderizando contenido');
    expect(output).not.toContain('✔ PDF');
    expect(output).not.toContain('✔ HTML');
  });

  it('el resumen usa el mismo glifo de éxito que las filas', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery']);
      await tracker.finish(1, 0, []);
    });

    expect(output).toContain('✔ Todo listo.');
    expect(output).not.toContain('✓ Todo listo.');
  });

  it('al actualizar una fila en TTY resetea la columna antes de escribir (regresión: indentaciones fantasma)', async () => {
    const output = await runTracker(
      async (tracker) => {
        tracker.startPhase('discovery', 2);
        tracker.reportFile({ relativePath: 'a.md', phase: 'discovery' });
        tracker.reportFile({ relativePath: 'b.md', phase: 'discovery' });
        tracker.completePhase(2);
      },
      { renderer: 'default', tty: true },
    );

    // Toda re-escritura de fila en TTY (mover arriba + borrar) debe resetear
    // la columna con \r antes del contenido: sin él, el texto se escribe a la
    // altura del ancho de la fila inferior.
    const esc = String.fromCharCode(27);
    const rewriteRe = new RegExp(`${esc}\\[\\d+A${esc}\\[2K(.)`, 'g');
    const reWrites = output.match(new RegExp(`${esc}\\[\\d+A${esc}\\[2K`, 'g')) ?? [];
    expect(reWrites.length).toBeGreaterThan(0);
    for (const m of output.matchAll(rewriteRe)) {
      expect(m[1]).toBe('\r');
    }
  });
});
