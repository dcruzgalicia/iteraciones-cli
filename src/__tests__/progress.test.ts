import { describe, expect, it, spyOn } from 'bun:test';
import { ProgressTracker } from '../cli/progress.js';

/**
 * Verifica el comportamiento del ProgressTracker en sus dos modos:
 * - Non-TTY: salida plana por fases, sin caracteres de control (pipes/CI)
 * - TTY: línea de progreso en vivo con \r y conteo [i/N]
 */

function captureOutput(fn: (write: (s: string) => void) => void, isTTY: boolean): string {
  const original = process.stdout.write;
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  let output = '';
  const spy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
  try {
    Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
    fn((s: string) => void s);
  } finally {
    spy.mockRestore();
    if (originalIsTTY) {
      Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
    }
  }
  return output;
}

describe('ProgressTracker', () => {
  it('en non-TTY emite salida plana sin carriage returns', () => {
    const output = captureOutput(() => {
      const tracker = new ProgressTracker({});
      tracker.startPhase('discovery', 2);
      tracker.completePhase(2);
      tracker.startPhase('pdf', 3);
      tracker.reportFile({ relativePath: 'a.md', phase: 'pdf' });
      tracker.reportFile({ relativePath: 'b.md', phase: 'pdf' });
      tracker.completePhase(3);
      tracker.finish(3, 0, ['pdf']);
    }, false);

    expect(output).not.toContain('\r');
    expect(output).toContain('■ Descubriendo documentos');
    expect(output).toContain('✓ Documentos encontrados 2');
    expect(output).toContain('✓ PDF 3');
  });

  it('en TTY muestra progreso en vivo con \r y conteo [i/N]', () => {
    const output = captureOutput(() => {
      const tracker = new ProgressTracker({});
      tracker.startPhase('pdf', 3);
      tracker.reportFile({ relativePath: 'a.md', phase: 'pdf' });
      tracker.reportFile({ relativePath: 'b.md', phase: 'pdf' });
      tracker.completePhase(3);
    }, true);

    expect(output).toContain('\r  PDF [1/3]');
    expect(output).toContain('\r  PDF [2/3]');
    expect(output).toContain('\r  ✓ PDF 3');
  });

  it('en TTY no muestra conteo sin reportes (fases sin notificación por documento)', () => {
    const output = captureOutput(() => {
      const tracker = new ProgressTracker({});
      tracker.startPhase('render', 4);
      tracker.completePhase(4);
    }, true);

    expect(output).not.toContain('[0/4]');
    expect(output).toContain('✓ Renderizando contenido 4');
  });
});
