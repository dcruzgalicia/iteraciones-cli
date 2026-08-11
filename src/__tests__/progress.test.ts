import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { ProgressTracker } from '../cli/progress.js';

/**
 * Mini-emulador de terminal: reconstruye la pantalla final a partir del
 * byte-stream capturado (maneja \x1b[nA/B, \x1b[2K, \r y \n con ONLCR).
 * Verifica el resultado visual real del renderer, no secuencias aisladas.
 */
function renderScreen(output: string): string[] {
  const screen: string[] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  const ensure = (line: number): void => {
    while (screen.length <= line) screen.push('');
  };
  while (i < output.length) {
    const ch = output[i];
    if (ch === '\x1b' && output[i + 1] === '[') {
      const m = /^\[(\d*)([A-Za-z])/.exec(output.slice(i + 1));
      if (m) {
        const n = (m[1] ?? '') === '' ? 1 : Number.parseInt(m[1] ?? '', 10);
        const cmd = m[2] ?? '';
        if (cmd === 'A') y = Math.max(0, y - n);
        else if (cmd === 'B') y += n;
        else if (cmd === 'K') {
          ensure(y);
          screen[y] = '';
        }
        i += m[0].length + 1;
        continue;
      }
    }
    if (ch === '\r') x = 0;
    else if (ch === '\n') {
      // ONLCR del terminal real: newline + retorno de columna
      y++;
      x = 0;
    } else {
      ensure(y);
      const line = screen[y] ?? '';
      screen[y] = line.slice(0, x) + ch + line.slice(x + 1);
      x++;
    }
    i++;
  }
  return screen;
}

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
    // Restaurar TTY y el spy de stdout: el sink de warnings (si lo hubo) se
    // restaura solo con runWithWarningSink; los tests no lo dejan activo.
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

  it('la pantalla final TTY mantiene cada fila en su línea y columna (regresión: indentaciones fantasma)', async () => {
    const output = await runTracker(
      async (tracker) => {
        tracker.setFormats([
          { phase: 'latex', active: false },
          { phase: 'pdf', active: true },
          { phase: 'html', active: true },
          { phase: 'epub', active: false },
          { phase: 'markdown', active: false },
        ]);
        tracker.startPhase('discovery', 1);
        tracker.reportFile({ relativePath: 'a.md', phase: 'discovery' });
        tracker.completePhase(1);
        await tracker.planPhases(['discovery', 'render']);
        // Intercalado real: live update en sitio + update final + filas nuevas
        tracker.startPhase('render', 1);
        tracker.reportFile({ relativePath: 'a.md', phase: 'render' });
        tracker.completePhase(1);
        tracker.completePhase(1, 'html');
        tracker.startPhase('pdf', 1);
        tracker.completePhase(1);
      },
      { renderer: 'default', tty: true },
    );

    const screen = renderScreen(output);
    const doneRow = (label: string): RegExp => new RegExp(`^${label}  \\d+ms$`);
    // Orden de filas: discovery, render, latex, epub, markdown, html, pdf
    expect(screen[0]).toMatch(doneRow('✔ Documentos encontrados 1'));
    expect(screen[1]).toMatch(doneRow('✔ Renderizando contenido 1'));
    expect(screen[2]).toBe('  – LaTeX (desactivado)');
    expect(screen[3]).toBe('  – EPUB (desactivado)');
    expect(screen[4]).toBe('  – Markdown (desactivado)');
    // Las filas nuevas tras un update en sitio NO heredan la columna residual
    // (sin el \r de restauración, estas líneas mezclaban ambos contenidos).
    expect(screen[5]).toMatch(doneRow('  ✔ HTML 1'));
    expect(screen[6]).toMatch(doneRow('  ✔ PDF 1'));
  });
});
