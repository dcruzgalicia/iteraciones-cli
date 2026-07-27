function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export interface RenderFileReport {
  relativePath: string;
  phase: PipelinePhase;
}

export type PipelinePhase = 'discovery' | 'render' | 'latex' | 'markdown' | 'pdf' | 'epub' | 'html';

interface PhaseMeta {
  label: string;
  section: string | null;
}

const PHASE_META: Record<PipelinePhase, PhaseMeta> = {
  discovery: { label: 'Documentos encontrados', section: 'Descubriendo documentos' },
  render: { label: 'Preparando contenido', section: 'Preparando contenido' },
  latex: { label: 'LaTeX', section: 'Generando formatos' },
  pdf: { label: 'PDF', section: 'Generando formatos' },
  html: { label: 'HTML', section: 'Generando formatos' },
  epub: { label: 'EPUB', section: 'Generando formatos' },
  markdown: { label: 'Markdown', section: 'Generando formatos' },
};

const PHASE_ORDER: PipelinePhase[] = ['discovery', 'render', 'latex', 'pdf', 'html', 'epub', 'markdown'];

export class ProgressTracker {
  private verbose: boolean;
  private t0: number;
  private phaseDurations: Partial<Record<PipelinePhase, number>> = {};
  private phaseCounts: Partial<Record<PipelinePhase, number>> = {};
  private currentPhase: PipelinePhase | null = null;
  private phaseStart: Partial<Record<PipelinePhase, number>> = {};
  private phaseDone: Set<PipelinePhase> = new Set();
  private sectionsShown: Set<string> = new Set();
  private phaseFiles: Partial<Record<PipelinePhase, string[]>> = {};

  constructor(options: { verbose?: boolean }) {
    this.verbose = options.verbose ?? false;
    this.t0 = performance.now();
  }

  log(msg: string): void {
    if (this.verbose) {
      process.stdout.write(`${msg}\n`);
    }
  }

  startPhase(phase: PipelinePhase, total: number = 0): void {
    this.currentPhase = phase;
    this.phaseCounts[phase] = total;
    this.phaseStart[phase] = performance.now();
    this.phaseFiles[phase] = [];

    const meta = PHASE_META[phase];
    if (meta.section && !this.sectionsShown.has(meta.section)) {
      this.sectionsShown.add(meta.section);
      if (this.verbose) {
        process.stdout.write(`\n\u25a0 ${meta.section}\n\n`);
      } else {
        process.stdout.write(`\n\u25a0 ${meta.section}\n`);
      }
    }
  }

  reportFile(file: RenderFileReport): void {
    // Colectar archivos solo para discovery (se muestran al completar fase)
    if (file.phase === 'discovery') {
      const files = this.phaseFiles[file.phase];
      if (files) files.push(file.relativePath);
    }
  }

  completePhase(actualCount?: number, phaseOverride?: PipelinePhase): void {
    const phase = phaseOverride ?? this.currentPhase;
    if (!phase || this.phaseDone.has(phase)) return;
    this.phaseDone.add(phase);

    const st = this.phaseStart[phase];
    const elapsed = st !== undefined ? performance.now() - st : 0;
    this.phaseDurations[phase] = elapsed;
    const meta = PHASE_META[phase];
    const count = actualCount ?? this.phaseCounts[phase] ?? 0;

    if (this.verbose) {
      if (meta.section === 'Descubriendo documentos' && count > 0) {
        process.stdout.write(`  ${count} documento${count !== 1 ? 's' : ''} encontrado${count !== 1 ? 's' : ''}.\n`);
        this.flushPhaseFiles(phase);
      } else if (meta.section === 'Generando formatos') {
        const durStr = formatTime(elapsed);
        process.stdout.write(`  ${meta.label}  ${durStr}\n\n`);
      }
    } else {
      const countPart = ` ${count}`;
      process.stdout.write(
        `  \u2713 ${meta.label}${countPart}${' '.repeat(Math.max(1, 30 - meta.label.length - countPart.length))}${formatTime(elapsed)}\n`,
      );
    }
  }

  finish(processed: number, cached: number, formats?: string[]): void {
    const totalTime = performance.now() - this.t0;
    const formatCount = formats ? formats.length : 0;

    if (this.verbose) {
      process.stdout.write('\u25a0 Resultado\n\n');
      process.stdout.write(`  ${padRight('Documentos procesados', 30)} ${processed}\n`);
      process.stdout.write(`  ${padRight('Formatos creados', 30)} ${formatCount}\n`);
      process.stdout.write(`  ${padRight('Tiempo total', 30)} ${formatTime(totalTime)}\n\n`);
      process.stdout.write('\u2713 Todo listo.\n');
    } else {
      process.stdout.write(`\n\u2713 Todo listo.\n\n`);
      process.stdout.write(`  ${padRight('Documentos procesados', 30)}${processed}\n`);
      if (cached > 0) {
        process.stdout.write(`  ${padRight('En cach\u00e9', 30)}${cached}\n`);
      }
      process.stdout.write(`  ${padRight('Formatos creados', 30)}${formatCount}\n`);
      process.stdout.write(`  ${padRight('Tiempo total', 30)}${formatTime(totalTime)}\n`);
    }
  }

  showCleanup(): void {
    if (this.verbose) {
      process.stdout.write('\u25a0 Preparaci\u00f3n\n\n');
      process.stdout.write('  \u2713 Se limpiaron los archivos temporales.\n');
    } else {
      process.stdout.write('\u25a0 Preparaci\u00f3n\n');
      process.stdout.write('  \u2713 Archivos temporales limpiados\n');
    }
  }

  private flushPhaseFiles(phase: PipelinePhase): void {
    const files = this.phaseFiles[phase];
    if (files && files.length > 0) {
      for (const f of files) {
        process.stdout.write(`    ${f}\n`);
      }
    }
  }
}

function padRight(s: string, w: number): string {
  return s.length < w ? s + ' '.repeat(w - s.length) : s;
}
