import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProgressTracker } from '../cli/progress.js';
import { withTempDir } from './helpers.js';

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

describe('renderer TTY (stream inyectado)', () => {
  /** Stream de captura: los tests no dependen de process.stdout global. */
  function fakeStream(): { stream: NodeJS.WriteStream; chunks: string[] } {
    const chunks: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string | Uint8Array): boolean {
        chunks.push(String(chunk));
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    return { stream, chunks };
  }

  it('re-renderiza en sitio con secuencias de posicionamiento (up + borrado + down)', async () => {
    const { stream, chunks } = fakeStream();
    const tracker = new ProgressTracker({ renderer: 'default', stream, tty: true });
    tracker.startPhase('discovery', 1);
    tracker.completePhase(1);
    await tracker.planPhases(['discovery', 'render']);
    tracker.startPhase('render', 1);
    tracker.reportFile({ relativePath: 'a.md', phase: 'render' });
    await tracker.finish(1, 0, ['html']);
    const output = chunks.join('');
    // Actualización en sitio: subir a la fila, borrarla, reescribir y volver
    expect(output).toContain('\x1b[1A\x1b[2K\r');
    expect(output).toContain('\x1b[1B\r');
    expect(output).toContain('[1/1]');
  });

  it('invariante del cursor: tras una actualización en sitio termina en la última línea, columna 0', async () => {
    const { stream, chunks } = fakeStream();
    const tracker = new ProgressTracker({ renderer: 'default', stream, tty: true });
    tracker.startPhase('discovery', 1);
    tracker.completePhase(1);
    await tracker.planPhases(['discovery', 'render']);
    tracker.startPhase('render', 1);
    tracker.reportFile({ relativePath: 'a.md', phase: 'render' });
    tracker.reportFile({ relativePath: 'b.md', phase: 'render' });
    // Tras cada actualización en sitio, la última escritura termina en \r
    // (columna 0 de la fila reescrita) y el cursor queda en la última línea.
    for (const chunk of chunks) {
      if (chunk.includes('\x1b[')) {
        expect(chunk.endsWith('\r')).toBe(true);
      }
    }
    await tracker.finish(2, 0, ['html']);
  });

  it('restaura el cursor en el evento exit (\x1b[?25h al stream del tracker)', async () => {
    const { stream, chunks } = fakeStream();
    // eslint-disable-next-line no-new
    new ProgressTracker({ renderer: 'default', stream, tty: true });
    process.emit('exit');
    const output = chunks.join('');
    expect(output).toContain('\x1b[?25h');
  });

  it('en no-TTY imprime estados finales sin ANSI al stream inyectado', async () => {
    const { stream, chunks } = fakeStream();
    const tracker = new ProgressTracker({ renderer: 'default', stream, tty: false });
    tracker.startPhase('discovery', 1);
    tracker.completePhase(1);
    await tracker.planPhases(['discovery', 'render']);
    tracker.startPhase('render', 1);
    tracker.reportFile({ relativePath: 'a.md', phase: 'render' });
    tracker.completePhase(1);
    await tracker.finish(1, 0, ['html']);
    const output = chunks.join('');
    expect(output).not.toContain('\x1b[');
    expect(output).toContain('✔ Documentos encontrados 1');
    expect(output).toContain('✔ Renderizando contenido 1');
  });
});

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

  it('con index.html la sugerencia post-build apunta al archivo', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'out'), { recursive: true });
      await writeFile(join(dir, 'out', 'index.html'), '<html></html>', 'utf8');
      const output = await runTracker(async (tracker) => {
        await tracker.finish(1, 0, ['html'], join(dir, 'out'));
      });
      expect(output).toContain(`open "${join(dir, 'out', 'index.html')}"`);
    });
  });

  it('sin index.html la sugerencia post-build apunta al directorio de salida', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'out'), { recursive: true });
      const output = await runTracker(async (tracker) => {
        await tracker.finish(1, 0, ['html'], join(dir, 'out'));
      });
      expect(output).toContain(`open "${join(dir, 'out')}"`);
      expect(output).not.toContain('index.html');
    });
  });

  it('sin trabajo (processed 0) no muestra la sugerencia post-build', async () => {
    await withTempDir(async (dir) => {
      const output = await runTracker(async (tracker) => {
        await tracker.finish(0, 1, ['html'], join(dir, 'out'));
      });
      expect(output).not.toContain('Abre el resultado');
    });
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

  it('con advertencias cierra con línea explícita, sugiere validate y lista las advertencias', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery']);
      // El orquestador conecta el sink de warnings en modo no verbose
      tracker.addWarning('⚠ [config] primera advertencia');
      tracker.addWarning('⚠ [discover] segunda advertencia');
      await tracker.finish(1, 0, []);
    });

    expect(output).not.toContain('✔ Todo listo.');
    expect(output).toContain("⚠ Build completado con 2 advertencias. Ejecuta 'iteraciones validate' para más detalle.");
    expect(output).toContain('Advertencias:');
    expect(output).toContain('primera advertencia');
    expect(output).toContain('segunda advertencia');
  });

  it('con una sola advertencia usa el singular', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery']);
      tracker.addWarning('⚠ [config] única advertencia');
      await tracker.finish(1, 0, []);
    });

    expect(output).toContain('Build completado con 1 advertencia.');
  });

  it('solo con advertencias de proyecto vacío (autosuficientes) no sugiere validate', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery']);
      tracker.addWarning('⚠ [build] No se encontraron documentos Markdown en el proyecto.');
      tracker.addWarning("⚠ [build] Crea un archivo .md con frontmatter o ejecuta 'iteraciones init'.");
      await tracker.finish(0, 0, []);
    });

    expect(output).toContain('Build completado con 2 advertencias.');
    expect(output).not.toContain("ejecuta 'iteraciones validate'");
    expect(output).toContain('Advertencias:');
    expect(output).toContain("ejecuta 'iteraciones init'");
  });

  it('con una advertencia de config junto a las de proyecto vacío, la guía de validate sí aparece', async () => {
    const output = await runTracker(async (tracker) => {
      tracker.startPhase('discovery', 1);
      tracker.completePhase(1);
      await tracker.planPhases(['discovery']);
      tracker.addWarning('⚠ [config] 25-pdfx desactiva los enlaces del PDF');
      tracker.addWarning('⚠ [build] No se encontraron documentos Markdown en el proyecto.');
      tracker.addWarning("⚠ [build] Crea un archivo .md con frontmatter o ejecuta 'iteraciones init'.");
      await tracker.finish(0, 0, []);
    });

    expect(output).toContain("Build completado con 3 advertencias. Ejecuta 'iteraciones validate' para más detalle.");
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

describe('invariantes de cursor (parte 2 del refactor)', () => {
  /** Stream de captura (mismo patrón que el primer describe). */
  function fakeStream(): { stream: NodeJS.WriteStream; chunks: string[] } {
    const chunks: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string | Uint8Array): boolean {
        chunks.push(String(chunk));
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    return { stream, chunks };
  }

  it('tras una secuencia completa, cada actualización ANSI termina en columna 0 y la pantalla queda íntegra', async () => {
    const { stream, chunks } = fakeStream();
    const tracker = new ProgressTracker({ renderer: 'default', stream, tty: true });
    tracker.setFormats([
      { phase: 'latex', active: false },
      { phase: 'pdf', active: true },
      { phase: 'html', active: true },
      { phase: 'epub', active: false },
      { phase: 'markdown', active: false },
    ]);
    tracker.startPhase('discovery', 2);
    tracker.reportFile({ relativePath: 'a.md', phase: 'discovery' });
    tracker.reportFile({ relativePath: 'b.md', phase: 'discovery' });
    tracker.completePhase(2);
    await tracker.planPhases(['discovery', 'render']);
    tracker.startPhase('render', 3);
    tracker.reportFile({ relativePath: 'd1.md', phase: 'render' });
    tracker.reportFile({ relativePath: 'd2.md', phase: 'render' });
    tracker.reportFile({ relativePath: 'd3.md', phase: 'render' });
    tracker.completePhase(3);
    tracker.completePhase(3, 'html');
    tracker.startPhase('pdf', 3);
    tracker.reportFile({ relativePath: 'd1.md', phase: 'pdf' });
    tracker.reportFile({ relativePath: 'd2.md', phase: 'pdf' });
    tracker.reportFile({ relativePath: 'd3.md', phase: 'pdf' });
    tracker.completePhase(3);
    await tracker.finish(5, 1, ['pdf', 'html']);

    const output = chunks.join('');
    // Invariante 1: toda actualización en sitio termina en \r (columna 0)
    for (const chunk of chunks) {
      if (chunk.includes('\x1b[')) {
        expect(chunk.endsWith('\r')).toBe(true);
      }
    }
    // Invariante 2: la pantalla final reconstruida no tiene residuos ni
    // filas fuera de lugar (mismo criterio visual que la regresión #1536)
    const screen = renderScreen(output);
    const doneRow = (label: string): RegExp => new RegExp(`^${label}  \\d+ms$`);
    expect(screen[0]).toMatch(doneRow('✔ Documentos encontrados 2'));
    expect(screen[1]).toMatch(doneRow('✔ Renderizando contenido 3'));
    expect(screen[2]).toBe('  – LaTeX (desactivado)');
    expect(screen[3]).toBe('  – EPUB (desactivado)');
    expect(screen[4]).toBe('  – Markdown (desactivado)');
    expect(screen[5]).toMatch(doneRow('  ✔ HTML 3'));
    expect(screen[6]).toMatch(doneRow('  ✔ PDF 3'));
    // El grupo se completa cuando todas las filas de formato se cerraron
    expect(screen[7]).toBe('✔ Generando formatos');
    // El resumen sigue a las filas (el cursor termina en la última línea)
    expect(output).toContain('Todo listo.');
  });

  it('tras fail(), la fila activa queda marcada con ✖ y las filas posteriores no muestran éxito', async () => {
    const { stream, chunks } = fakeStream();
    const tracker = new ProgressTracker({ renderer: 'default', stream, tty: true });
    tracker.setFormats([
      { phase: 'html', active: true },
      { phase: 'pdf', active: false },
    ]);
    tracker.startPhase('discovery', 1);
    tracker.reportFile({ relativePath: 'a.md', phase: 'discovery' });
    tracker.completePhase(1);
    await tracker.planPhases(['discovery', 'render']);
    tracker.startPhase('render', 1);
    tracker.reportFile({ relativePath: 'a.md', phase: 'render' });
    // El build falla durante render: la fase activa se marca fallida y las
    // filas de formato pendientes NUNCA muestran estado de éxito
    await tracker.fail();

    const screen = renderScreen(chunks.join(''));
    expect(screen[0]).toMatch(/^✔ Documentos encontrados 1/);
    expect(screen[1]).toMatch(/^✖ Renderizando contenido/);
    expect(screen[2]).toBe('  – PDF (desactivado)');
    // html quedó pendiente: no debe verse como éxito ni como fallo
    expect(screen[3]).toBeUndefined();
    // No hay resumen tras un fallo (el error ya se reportó)
    expect(chunks.join('')).not.toContain('Todo listo.');
  });
});
