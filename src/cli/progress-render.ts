import { GLYPHS } from '../lib/logger.js';
import type { RowState, TrackerState } from './progress-state.js';

export function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export class TrackerRenderer {
  private rowIndex = new Map<string, number>();
  private nextLine = 0;
  private cursorLine = 0;

  constructor(
    private readonly stream: NodeJS.WriteStream,
    private readonly tty: boolean,
  ) {}

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
    const countPart = row.count > 0 ? ` ${row.count}` : '';
    const timePart = row.elapsed !== undefined ? `${countPart === '' ? ' ' : '  '}${formatTime(row.elapsed)}` : '';
    const livePart = live !== undefined ? ` ${live}` : '';
    return `${indent}${prefix}${row.label}${countPart}${timePart}${livePart}`;
  }

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
        const up = this.cursorLine - idx;
        this.stream.write(`\x1b[${up}A\x1b[2K\r${content}\x1b[${up}B\r`);
      }
    } else if (idx === undefined && (row.status === 'done' || row.status === 'skipped' || row.status === 'failed')) {
      this.stream.write(`${content}\n`);
      this.rowIndex.set(key, this.nextLine++);
    }
  }
}
