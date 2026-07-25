function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function padRight(s: string, w: number): string {
  return s.length < w ? s + ' '.repeat(w - s.length) : s;
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
  /** Label para modo verbose en el resumen de tiempos. */
  verboseLabel: string;
  /** Título del grupo en modo normal. null = sin grupo. */
  group: string | null;
  /** Etiqueta corta para el conteo de documentos procesados. */
  countLabel: string | null;
}

const PHASE_META: Record<PipelinePhase, PhaseMeta> = {
  discovery: {
    label: 'Documentos encontrados',
    verboseLabel: 'Buscar documentos',
    group: 'Preparando proyecto',
    countLabel: 'Documentos encontrados',
  },
  render: { label: 'Documentos preparados', verboseLabel: 'Preparar documentos', group: 'Preparando proyecto', countLabel: null },
  latex: { label: 'LaTeX', verboseLabel: 'Generar LaTeX', group: 'Generando archivos', countLabel: null },
  pdf: { label: 'PDF', verboseLabel: 'Generar PDF', group: 'Generando archivos', countLabel: 'PDF generado' },
  html: { label: 'HTML', verboseLabel: 'Generar HTML', group: 'Generando archivos', countLabel: 'HTML generado' },
  epub: { label: 'EPUB', verboseLabel: 'Generar EPUB', group: 'Generando archivos', countLabel: 'EPUB generado' },
  markdown: { label: 'Markdown', verboseLabel: 'Generar Markdown', group: 'Generando archivos', countLabel: 'Markdown generado' },
  compose: { label: 'Componer', verboseLabel: 'Componer', group: null, countLabel: null },
};

const PHASE_ORDER: PipelinePhase[] = ['discovery', 'render', 'latex', 'pdf', 'html', 'epub', 'markdown', 'compose'];

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  html: 'HTML',
  epub: 'EPUB',
  markdown: 'Markdown',
};

export class ProgressTracker {
  private verbose: boolean;
  private t0: number;
  private phaseDurations: Partial<Record<PipelinePhase, number>> = {};
  private phaseCounts: Partial<Record<PipelinePhase, number>> = {};
  private currentPhase: PipelinePhase | null = null;
  private phaseStart: number = 0;
  private groupShown: Set<string> = new Set();

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

    const meta = PHASE_META[phase];
    if (!this.verbose && meta.group && !this.groupShown.has(meta.group)) {
      this.groupShown.add(meta.group);
      process.stdout.write(`\n${meta.group}\n`);
    }
  }

  advance(_by: number = 1): void {
    // No progress bars in normal mode
  }

  reportFile(file: RenderFileReport): void {
    if (this.verbose) {
      const tag = `[${file.phase}]`;
      const time = formatTime(file.durationMs);
      const cache = file.cacheHit ? ' (cach\u00e9)' : '';
      process.stdout.write(`  ${tag} ${file.relativePath} \u2192 ${time}${cache}\n`);
    }
  }

  completePhase(actualCount?: number): void {
    const phase = this.currentPhase;
    if (!phase) return;
    const elapsed = performance.now() - this.phaseStart;
    this.phaseDurations[phase] = elapsed;
    const meta = PHASE_META[phase];

    if (this.verbose) {
      // No verbose output for phase completion; use finish()
    } else {
      const count = actualCount ?? this.phaseCounts[phase] ?? 0;
      const countPart = count > 0 ? ` (${count})` : '';
      process.stdout.write(
        `  \u2713 ${meta.label}${countPart}${' '.repeat(Math.max(1, 32 - meta.label.length - countPart.length))}${formatTime(elapsed)}\n`,
      );
    }

    this.currentPhase = null;
  }

  finish(processed: number, cached: number, formats?: string[]): void {
    const totalTime = performance.now() - this.t0;

    if (this.verbose) {
      this.renderVerboseSummary(totalTime, formats);
    } else {
      this.renderNormalSummary(totalTime, processed, cached, formats);
    }
  }

  private renderNormalSummary(totalTime: number, processed: number, cached: number, formats?: string[]): void {
    process.stdout.write(`\n\u2713 Proyecto generado correctamente\n\n`);
    process.stdout.write(`  Documentos: ${processed}\n`);
    if (cached > 0) {
      process.stdout.write(`  En cach\u00e9: ${cached}\n`);
    }
    if (formats && formats.length > 0) {
      const visible = formats.filter((f) => FORMAT_LABELS[f]).map((f) => FORMAT_LABELS[f]!);
      process.stdout.write(`  Archivos: ${visible.join(', ')}\n`);
    }
    process.stdout.write(`  Tiempo total: ${formatTime(totalTime)}\n`);
  }

  private renderVerboseSummary(totalTime: number, formats?: string[]): void {
    process.stdout.write(`\nResumen\n\n`);

    for (const ph of PHASE_ORDER) {
      const meta = PHASE_META[ph];
      const count = this.phaseCounts[ph] ?? 0;
      if (meta.countLabel && count > 0) {
        process.stdout.write(`  ${padRight(meta.countLabel, 26)}${count}\n`);
      }
    }

    process.stdout.write(`\nTiempo por etapa\n\n`);
    for (const ph of PHASE_ORDER) {
      const dur = this.phaseDurations[ph];
      if (dur !== undefined) {
        const meta = PHASE_META[ph];
        const label = meta.verboseLabel;
        process.stdout.write(`  ${padRight(label, 26)}${formatTime(dur)}\n`);
      }
    }

    process.stdout.write(`\n  ${padRight('Tiempo total', 26)}${formatTime(totalTime)}\n`);
  }
}
