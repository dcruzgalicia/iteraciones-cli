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
  discovery: 'Buscando documentos',
  render: 'Procesando contenido',
  context: 'Construyendo \u00edndices',
  latex: 'LaTeX',
  markdown: 'Markdown',
  pdf: 'PDF',
  epub: 'EPUB',
  html: 'HTML',
  compose: 'Componiendo',
};

/** Agrupación de fases en secciones con su propio contador. */
const PHASE_GROUPS: { title: string; phases: PipelinePhase[] }[] = [
  { title: 'Preparando proyecto', phases: ['discovery', 'render'] },
  { title: 'Generando formatos', phases: ['latex', 'pdf', 'html', 'epub', 'markdown'] },
];

const FORMAT_GROUP_INDEX = 1;

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
  private currentGroupIndex: number = -1;
  private groupPhaseIndex: number = 0;
  private groupPhaseTotal: number = 0;

  constructor(options: { verbose?: boolean }) {
    this.verbose = options.verbose ?? false;
    this.tty = isTTY();
    this.t0 = performance.now();
  }

  /**
   * Define qué fases de formato están activas para el contador [1/N].
   * Debe llamarse antes de iniciar la primera fase de formato.
   */
  setFormatPhases(phases: PipelinePhase[]): void {
    if (phases.length > 0) {
      PHASE_GROUPS[FORMAT_GROUP_INDEX]!.phases = phases;
    }
  }

  private stderrLine(text: string): void {
    this.clearLine();
    process.stderr.write(`${text}\n`);
  }

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

  log(msg: string): void {
    if (this.verbose) {
      this.clearLine();
      process.stdout.write(`${msg}\n`);
    }
  }

  setExcludedDrafts(count: number): void {
    this.excludedDraftsCount = count;
  }

  /** Busca el grupo al que pertenece una fase y actualiza el contador. */
  private locateGroup(phase: PipelinePhase): void {
    for (let g = 0; g < PHASE_GROUPS.length; g++) {
      const group = PHASE_GROUPS[g]!;
      const pIdx = group.phases.indexOf(phase);
      if (pIdx !== -1) {
        if (g !== this.currentGroupIndex) {
          this.currentGroupIndex = g;
          this.groupPhaseIndex = 0;
          this.groupPhaseTotal = group.phases.length;
          if (!this.verbose && this.tty) {
            this.clearLine();
            process.stderr.write(`\n${group.title}\n`);
          }
        }
        this.groupPhaseIndex = pIdx + 1;
        return;
      }
    }
    if (this.currentGroupIndex === -1) {
      this.groupPhaseTotal = 0;
      this.groupPhaseIndex = 0;
    }
  }

  startPhase(phase: PipelinePhase, total: number = 0): void {
    this.locateGroup(phase);
    this.currentPhase = phase;
    this.phaseTotal = total;
    this.phaseDone = 0;
    this.phaseStart = performance.now();

    if (this.verbose) {
      this.clearLine();
      process.stdout.write(`\n\u2500\u2500 ${PHASE_LABELS[phase]} \u2500\u2500\n`);
    } else if (this.tty) {
      const b = this.bar(0, total || 1);
      this.render(`  ${PHASE_LABELS[phase]}: ${b} 0/${total || '?'}`);
    }
  }

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

  reportFile(file: RenderFileReport): void {
    if (this.verbose) {
      const tag = `[${file.phase}]`;
      const time = formatTime(file.durationMs);
      const cache = file.cacheHit ? ' (cach\u00e9)' : '';
      this.clearLine();
      process.stdout.write(`  ${tag} ${file.relativePath} \u2192 ${time}${cache}\n`);
    } else {
      this.advance();
    }
  }

  completePhase(actualCount?: number): void {
    const phase = this.currentPhase;
    if (!phase) return;
    const elapsed = performance.now() - this.phaseStart;
    this.phaseDurations[phase] = elapsed;

    const hasCounter = this.groupPhaseTotal > 0;
    const counter = hasCounter ? `[${this.groupPhaseIndex}/${this.groupPhaseTotal}] ` : '';

    if (this.verbose) {
      this.clearLine();
      process.stdout.write(`  ${counter}\u2713 ${formatTime(elapsed)}\n\n`);
    } else if (this.tty) {
      this.clearLine();
      process.stderr.write(`${counter}${PHASE_LABELS[phase]} \u2713 ${formatTime(elapsed)}\n`);
    }
    this.currentPhase = null;
  }

  finish(processed: number, cached: number, formats?: string[]): void {
    this.clearLine();
    const elapsed = formatTime(performance.now() - this.t0);
    const fmtLabel = formats && formats.length > 0 ? formats.join(', ') : '';

    if (this.verbose) {
      process.stdout.write(`\n\u2500\u2500 Resumen \u2500\u2500\n`);
      let prevT = this.t0;
      for (const ph of PHASE_ORDER) {
        const dur = this.phaseDurations[ph];
        if (dur !== undefined) {
          process.stdout.write(`  ${PHASE_LABELS[ph]} ${formatTime(dur)}\n`);
          prevT += dur;
        }
      }
      process.stdout.write(`\nBuild completado ${processed} documento${processed !== 1 ? 's' : ''} en ${elapsed}`);
      if (cached > 0) {
        process.stdout.write(` (${cached} en cach\u00e9)`);
      }
      if (fmtLabel) process.stdout.write(` [${fmtLabel}]`);
      process.stdout.write(`\n`);
    } else if (this.tty) {
      process.stderr.write(`\n\u2713 Build completado\n`);
      process.stderr.write(`  Documentos procesados: ${processed}\n`);
      if (cached > 0) {
        process.stderr.write(`  Documentos en cach\u00e9: ${cached}\n`);
      }
      if (fmtLabel) {
        process.stderr.write(`  Formatos generados: ${fmtLabel}\n`);
      }
      process.stderr.write(`  Tiempo total: ${elapsed}\n`);
    } else {
      process.stdout.write(`\u2713 Build completado: ${processed} doc${processed !== 1 ? 's' : ''} procesado${processed !== 1 ? 's' : ''}`);
      if (cached > 0) process.stdout.write(`, ${cached} en cach\u00e9`);
      if (fmtLabel) process.stdout.write(` [${fmtLabel}]`);
      process.stdout.write(` (${elapsed})\n`);
    }
  }
}
