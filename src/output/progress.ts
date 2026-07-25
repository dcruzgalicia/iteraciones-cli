function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export interface RenderFileReport {
  relativePath: string;
  durationMs: number;
  cacheHit: boolean;
  phase: PipelinePhase;
}

export type PipelinePhase = 'discovery' | 'render' | 'latex' | 'markdown' | 'pdf' | 'epub' | 'html' | 'compose';

interface PhaseMeta {
  label: string;
  section: string | null;
}

const PHASE_META: Record<PipelinePhase, PhaseMeta> = {
  discovery: { label: 'Documentos encontrados', section: 'Descubriendo documentos' },
  render: { label: 'Preparando contenido', section: 'Preparando contenido' },
  latex: { label: 'LaTeX', section: 'Generando publicaciones' },
  pdf: { label: 'PDF', section: 'Generando publicaciones' },
  html: { label: 'HTML', section: 'Generando publicaciones' },
  epub: { label: 'EPUB', section: 'Generando publicaciones' },
  markdown: { label: 'Markdown', section: 'Generando publicaciones' },
  compose: { label: 'Componer', section: null },
};

const PHASE_ORDER: PipelinePhase[] = ['discovery', 'render', 'latex', 'pdf', 'html', 'epub', 'markdown', 'compose'];

export class ProgressTracker {
  private verbose: boolean;
  private t0: number;
  private phaseDurations: Partial<Record<PipelinePhase, number>> = {};
  private phaseCounts: Partial<Record<PipelinePhase, number>> = {};
  private currentPhase: PipelinePhase | null = null;
  private phaseStart: number = 0;
  private sectionsShown: Set<string> = new Set();
  /** Archivos individuales reportados por fase (verbose). */
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
    this.phaseStart = performance.now();
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

  advance(_by: number = 1): void {
    // No progress bars
  }

  reportFile(file: RenderFileReport): void {
    if (this.verbose) {
      const files = this.phaseFiles[file.phase];
      if (files) files.push(file.relativePath);
    }
  }

  private flushPhaseFiles(phase: PipelinePhase): void {
    const files = this.phaseFiles[phase];
    if (!files || files.length === 0) return;
    for (const f of files) {
      process.stdout.write(`    ${f}\n`);
    }
  }

  completePhase(actualCount?: number): void {
    const phase = this.currentPhase;
    if (!phase) return;
    const elapsed = performance.now() - this.phaseStart;
    this.phaseDurations[phase] = elapsed;

    if (this.verbose) {
      // En verbose, mostrar archivos de esta fase inmediatamente
      const meta = PHASE_META[phase];
      if (meta.section === 'Descubriendo documentos') {
        const count = actualCount ?? this.phaseCounts[phase] ?? 0;
        if (count > 0) {
          process.stdout.write(`  ${count} documento${count !== 1 ? 's' : ''} encontrado${count !== 1 ? 's' : ''}.\n\n`);
          this.flushPhaseFiles(phase);
          process.stdout.write('\n');
        }
      }
    } else {
      const meta = PHASE_META[phase];
      const count = actualCount ?? this.phaseCounts[phase] ?? 0;
      const countPart = count > 0 ? ` ${count}` : '';
      process.stdout.write(
        `  \u2713 ${meta.label}${countPart}${' '.repeat(Math.max(1, 30 - meta.label.length - countPart.length))}${formatTime(elapsed)}\n`,
      );
    }

    this.currentPhase = null;
  }

  finish(processed: number, cached: number, formats?: string[]): void {
    const totalTime = performance.now() - this.t0;

    if (this.verbose) {
      this.renderVerbose(totalTime, processed, cached, formats);
    } else {
      this.renderNormal(totalTime, processed, cached, formats);
    }
  }

  /** Muestra la seccion de preparacion (cleanup) */
  showCleanup(): void {
    if (this.verbose) {
      process.stdout.write('\u25a0 Preparaci\u00f3n\n\n');
      process.stdout.write('  \u2713 Se limpiaron los archivos temporales.\n');
    } else {
      process.stdout.write('\u25a0 Preparaci\u00f3n\n');
      process.stdout.write('  \u2713 Archivos temporales limpiados\n');
    }
  }

  private renderNormal(totalTime: number, processed: number, cached: number, formats?: string[]): void {
    const formatCount = formats ? formats.filter((f) => f !== 'latex').length : 0;

    process.stdout.write(`\n\u2713 Todo listo.\n\n`);
    process.stdout.write(`  ${padRight('Documentos procesados', 30)}${processed}\n`);
    if (cached > 0) {
      process.stdout.write(`  ${padRight('En cach\u00e9', 30)}${cached}\n`);
    }
    process.stdout.write(`  ${padRight('Publicaciones creadas', 30)}${formatCount}\n`);
    process.stdout.write(`  ${padRight('Tiempo total', 30)}${formatTime(totalTime)}\n`);
  }

  private renderVerbose(totalTime: number, processed: number, cached: number, formats?: string[]): void {
    const formatCount = formats ? formats.filter((f) => f !== 'latex').length : 0;

    // Seccion: Generando publicaciones
    for (const ph of PHASE_ORDER) {
      const meta = PHASE_META[ph];
      if (meta.section !== 'Generando publicaciones') continue;
      const dur = this.phaseDurations[ph];
      const durStr = dur !== undefined ? formatTime(dur) : '';

      if (!this.phaseCounts[ph]) continue;

      process.stdout.write(`  ${meta.label}\n`);
      this.flushPhaseFiles(ph);
      if (durStr) {
        process.stdout.write(`    ${durStr}\n`);
      }
      process.stdout.write('\n');
    }

    // Resultado
    process.stdout.write('\u25a0 Resultado\n\n');
    process.stdout.write(`  ${padRight('Documentos procesados', 30)} ${processed}\n`);
    process.stdout.write(`  ${padRight('Publicaciones creadas', 30)} ${formatCount}\n`);
    process.stdout.write(`  ${padRight('Tiempo total', 30)} ${formatTime(totalTime)}\n\n`);

    process.stdout.write('\u2713 Todo listo.\n');
  }
}

function padRight(s: string, w: number): string {
  return s.length < w ? s + ' '.repeat(w - s.length) : s;
}
