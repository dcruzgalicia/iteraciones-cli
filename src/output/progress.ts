function isTTY(): boolean {
  return process.stderr.isTTY === true;
}

function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export interface RenderFileReport {
  relativePath: string;
  durationMs: number;
  cacheHit: boolean;
  phase: PipelinePhase;
}

export type PipelinePhase = 'discovery' | 'render' | 'context' | 'latex' | 'markdown' | 'pdf' | 'epub' | 'html' | 'compose';

const PHASE_LABELS: Record<PipelinePhase, string> = {
  discovery: 'Descubriendo documentos',
  render: 'Renderizando (pandoc)',
  context: 'Construyendo \u00edndices',
  latex: 'Generando .tex',
  markdown: 'Exportando Markdown',
  pdf: 'Compilando PDF',
  epub: 'Exportando EPUB',
  html: 'Componiendo HTML',
  compose: 'Componiendo',
};

const PHASE_ORDER: PipelinePhase[] = ['discovery', 'render', 'context', 'latex', 'pdf', 'html', 'epub', 'markdown'];

export class ProgressTracker {
  private verbose: boolean;
  private tty: boolean;
  private t0: number;
  private phaseDurations: Partial<Record<PipelinePhase, number>> = {};
  private currentPhase: PipelinePhase | null = null;
  private phaseStart: number = 0;
  private phaseTotal: number = 0;
  private phaseDone: number = 0;
  private lastLineLen: number = 0;
  private excludedDraftsCount: number = 0;

  constructor(options: { verbose?: boolean }) {
    this.verbose = options.verbose ?? false;
    this.tty = isTTY();
    this.t0 = performance.now();
  }

  /** Escribe a stderr, limpiando primero la línea del progress bar si existe. */
  private stderrLine(text: string): void {
    this.clearLine();
    process.stderr.write(`${text}\n`);
  }

  /** Renderiza el progress bar (solo stderr TTY en modo normal). */
  private render(text: string): void {
    if (!this.tty || this.verbose) return;
    const line = `\r${text}`;
    process.stderr.write(line);
    this.lastLineLen = text.length;
  }

  private clearLine(): void {
    if (this.lastLineLen > 0) {
      process.stderr.write(`\r${' '.repeat(this.lastLineLen)}\r`);
      this.lastLineLen = 0;
    }
  }

  private bar(done: number, total: number, width = 16): string {
    if (total === 0) return '░'.repeat(width);
    const filled = Math.round(Math.min(done / total, 1) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  /** Mensaje informativo solo en verbose. */
  log(msg: string): void {
    if (this.verbose) {
      this.clearLine();
      process.stdout.write(`${msg}\n`);
    }
  }

  setExcludedDrafts(count: number): void {
    this.excludedDraftsCount = count;
  }

  /** Abre una fase del pipeline con un total de trabajo conocido. */
  startPhase(phase: PipelinePhase, total: number = 0): void {
    this.currentPhase = phase;
    this.phaseTotal = total;
    this.phaseDone = 0;
    this.phaseStart = performance.now();

    if (this.verbose) {
      this.clearLine();
      process.stdout.write(`\n── ${PHASE_LABELS[phase]} ──\n`);
    } else if (this.tty) {
      const b = this.bar(0, total || 1);
      this.render(`  ${PHASE_LABELS[phase]}: ${b} 0/${total || '?'}`);
    }
  }

  /** Incrementa el contador de trabajo completado. */
  advance(by: number = 1): void {
    this.phaseDone += by;
    if (!this.verbose && this.tty && this.currentPhase) {
      if (this.phaseTotal > 0) {
        const b = this.bar(this.phaseDone, this.phaseTotal);
        this.render(`  ${PHASE_LABELS[this.currentPhase]}: ${b} ${this.phaseDone}/${this.phaseTotal}`);
      } else {
        this.render(`  ${PHASE_LABELS[this.currentPhase]}: ${this.phaseDone}`);
      }
    }
  }

  /** Reporta un archivo procesado (verbose: stdout; normal: bar). */
  reportFile(file: RenderFileReport): void {
    if (this.verbose) {
      const tag = `[${file.phase}]`;
      const time = formatTime(file.durationMs);
      const cache = file.cacheHit ? ' (caché)' : '';
      this.clearLine();
      process.stdout.write(`  ${tag} ${file.relativePath} → ${time}${cache}\n`);
    } else {
      this.advance();
    }
  }

  /** Cierra la fase actual y registra su duración. Muestra conteo si hay documentos procesados. */
  completePhase(actualCount?: number, formats?: number): void {
    const phase = this.currentPhase;
    if (!phase) return;
    const elapsed = performance.now() - this.phaseStart;
    this.phaseDurations[phase] = elapsed;

    const count = actualCount ?? this.phaseTotal;
    const countStr = count > 0 ? `${count} documento${count !== 1 ? 's' : ''} en ` : '';

    if (this.verbose) {
      this.clearLine();
      process.stdout.write(`  ✓ ${countStr}${formatTime(elapsed)}\n\n`);
    } else if (this.tty) {
      this.clearLine();
      process.stderr.write(`✓ ${PHASE_LABELS[phase]} ${countStr}${formatTime(elapsed)}\n`);
    }
    this.currentPhase = null;
  }

  /** Cierra el tracker con un resumen final. */
  finish(docCount: number, formatCount?: number): void {
    this.clearLine();
    const elapsed = formatTime(performance.now() - this.t0);

    const docWord = docCount === 1 ? 'documento' : 'documentos';
    let msg = `${docCount} ${docWord}`;
    if (formatCount !== undefined && formatCount > 0) {
      msg += ` exportado${docCount === 1 ? '' : 's'} a ${formatCount} formato${formatCount !== 1 ? 's' : ''}`;
    }
    msg += ` en ${elapsed}`;

    if (this.verbose) {
      process.stdout.write(`\n── Resumen ──\n`);
      let prevT = this.t0;
      for (const ph of PHASE_ORDER) {
        const dur = this.phaseDurations[ph];
        if (dur !== undefined) {
          process.stdout.write(`  ${PHASE_LABELS[ph]} ${formatTime(dur)}\n`);
          prevT += dur;
        }
      }
      process.stdout.write(`\nBuild completado ${msg}`);
    } else {
      process.stdout.write(`Build completado ${msg}`);
    }
    if (this.excludedDraftsCount > 0) {
      const word = this.excludedDraftsCount === 1 ? 'borrador' : 'borradores';
      process.stdout.write(` (${this.excludedDraftsCount} ${word} excluido${this.excludedDraftsCount > 1 ? 's' : ''} por draft:true)`);
    }
    process.stdout.write('\n');
  }
}
