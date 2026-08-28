/**
 * Renderer ANSI del tracker de progreso (parte 2 del refactor del
 * ProgressTracker).
 *
 * Único punto del módulo que emite secuencias de escape: toda la escritura
 * ANSI del tracker (filas interactivas en TTY, estados finales en no-TTY)
 * pasa por `TrackerRenderer`. El estado (TrackerState) es input: el renderer
 * nunca lo muta, solo lo lee y escribe en el stream.
 *
 * Invariantes de cursor (hoy garantizadas por diseño y cubiertas por tests):
 * - Tras cualquier operación, el cursor termina en la última línea escrita,
 *   columna 0.
 * - Toda actualización en sitio termina en `\r` (columna 0): `\x1b[2K` no
 *   mueve el cursor y `\x1b[nB` tampoco; sin el `\r`, la siguiente escritura
 *   empezaría en la columna residual del contenido anterior (indentaciones
 *   fantasma en TTY, regresión #1536).
 * - El posicionamiento usa `cursorLine` (la línea real del cursor), no
 *   `nextLine`: tras una actualización en sitio el cursor no está al final, y
 *   un `up` calculado contra nextLine subiría de más.
 */

import { GLYPHS } from '../lib/logger.js';
import type { RowState, TrackerState } from './progress-state.js';

export function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export class TrackerRenderer {
  // ── Marcas de escritura (líneas reales del terminal) ──
  private rowIndex = new Map<string, number>();
  private nextLine = 0;
  /** Línea real del cursor (0-based). Ver invariantes en la cabecera. */
  private cursorLine = 0;

  constructor(
    private readonly stream: NodeJS.WriteStream,
    private readonly tty: boolean,
  ) {}

  /** Imprime las filas de formatos desactivados al materializarse el bloque. */
  renderInactiveFormats(state: TrackerState): void {
    for (const f of state.formats) {
      const row = state.getRow(`fmt:${f.phase}`);
      if (row && row.status === 'skipped') this.renderRow(state, row.key);
    }
  }

  private rowContent(row: RowState, live?: string): string {
    const indent = '  '.repeat(row.indent);
    const prefix =
      row.status === 'done'
        ? `${GLYPHS.success} `
        : row.status === 'failed'
          ? `${GLYPHS.error} `
          : row.status === 'skipped'
            ? `${GLYPHS.skipped} `
            : '';
    // Con conteo, el tiempo va doblemente separado (formato asertado);
    // sin conteo, un solo espacio: «label  2ms» era ambiguo (#2192).
    const countPart = row.count > 0 ? ` ${row.count}` : '';
    const timePart = row.elapsed !== undefined ? `${countPart === '' ? ' ' : '  '}${formatTime(row.elapsed)}` : '';
    const livePart = live !== undefined ? ` ${live}` : '';
    return `${indent}${prefix}${row.label}${countPart}${timePart}${livePart}`;
  }

  /**
   * Escribe (o actualiza) la fila. En TTY las filas activas se re-renderizan en
   * sitio; en non-TTY solo se imprimen los estados finales (done/skipped).
   */
  renderRow(state: TrackerState, key: string, live?: string): void {
    const row = state.getRow(key);
    if (!row || row.status === 'pending') return;
    const content = this.rowContent(row, live);
    const idx = this.rowIndex.get(key);
    if (this.tty) {
      if (idx === undefined) {
        this.stream.write(`${content}\n`);
        this.rowIndex.set(key, this.nextLine);
        this.nextLine++;
        this.cursorLine = this.nextLine;
      } else {
        // Invariante: el cursor está en la última línea escrita, que es >= la
        // fila actualizada (la fila ya fue escrita antes). `\r` final restaura
        // la columna 0 tras `B` (ver cabecera).
        const up = this.cursorLine - idx;
        this.stream.write(`\x1b[${up}A\x1b[2K\r${content}\x1b[${up}B\r`);
      }
    } else if (idx === undefined && (row.status === 'done' || row.status === 'skipped' || row.status === 'failed')) {
      this.stream.write(`${content}\n`);
      this.rowIndex.set(key, this.nextLine++);
    }
  }
}
