function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Ancho mínimo para la columna de etiquetas en el resumen final. */
const LABEL_WIDTH = 30;

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
  render: { label: 'Renderizando contenido', section: 'Renderizando contenido' },
  latex: { label: 'LaTeX', section: 'Generando formatos' },
  pdf: { label: 'PDF', section: 'Generando formatos' },
  html: { label: 'HTML', section: 'Generando formatos' },
  epub: { label: 'EPUB', section: 'Generando formatos' },
  markdown: { label: 'Markdown', section: 'Generando formatos' },
};

/**
 * Tracker de progreso del build con dos modos:
 *
 * - **TTY interactivo**: las fases muestran el conteo en vivo en una sola
 *   línea (sobrescrita con carriage return `\r`, sin secuencias ANSI), de
 *   forma portable entre terminales.
 * - **Non-TTY / --verbose**: salida plana por fases (formato histórico), sin
 *   caracteres de control, legible en pipes y CI.
 *
 * Se descartó listr2 (issue #1104): su renderer emite códigos ANSI incluso en
 * modo non-TTY (verificado con color:false y renderers simple/verbose), y su
 * modelo task-driven choca con el flujo event-driven del orquestador.
 */
export class ProgressTracker {
  private verbose: boolean;
  private tty: boolean;
  private t0: number;
  private phaseDurations: Partial<Record<PipelinePhase, number>> = {};
  private phaseCounts: Partial<Record<PipelinePhase, number>> = {};
  private currentPhase: PipelinePhase | null = null;
  private phaseStart: Partial<Record<PipelinePhase, number>> = {};
  private phaseDone: Set<PipelinePhase> = new Set();
  private sectionsShown: Set<string> = new Set();
  private phaseFiles: Partial<Record<PipelinePhase, string[]>> = {};
  /** Documentos reportados en la fase actual (progreso en vivo en TTY). */
  private currentPhaseCount = 0;

  constructor(options: { verbose?: boolean }) {
    this.verbose = options.verbose ?? false;
    this.tty = process.stdout.isTTY === true && !this.verbose;
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
    this.currentPhaseCount = 0;

    const meta = PHASE_META[phase];
    if (meta.section && !this.sectionsShown.has(meta.section)) {
      this.sectionsShown.add(meta.section);
      if (this.verbose) {
        process.stdout.write(`\n\u25a0 ${meta.section}\n\n`);
      } else {
        process.stdout.write(`\n\u25a0 ${meta.section}\n`);
      }
    }
    if (this.tty) {
      this.renderPhaseLine();
    }
  }

  reportFile(file: RenderFileReport): void {
    // Colectar archivos solo para discovery (se muestran al completar fase)
    if (file.phase === 'discovery') {
      const files = this.phaseFiles[file.phase];
      if (files) files.push(file.relativePath);
    }
    // Progreso en vivo: cada documento completado actualiza la línea de la fase actual
    if (this.tty && file.phase === this.currentPhase) {
      this.currentPhaseCount++;
      this.renderPhaseLine();
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
    const count = actualCount ?? this.phaseCounts[phase] ?? this.currentPhaseCount;

    if (this.verbose) {
      if (meta.section === 'Descubriendo documentos' && count > 0) {
        process.stdout.write(`  ${count} documento${count !== 1 ? 's' : ''} encontrado${count !== 1 ? 's' : ''}.\n`);
        this.flushPhaseFiles(phase);
      } else if (meta.section === 'Generando formatos') {
        const durStr = formatTime(elapsed);
        process.stdout.write(`  ${meta.label}  ${durStr}\n\n`);
      }
    } else if (this.tty) {
      // Sobrescribir la línea de progreso en vivo con el resultado de la fase
      const countPart = ` ${count}`;
      process.stdout.write(
        `\r  \u2713 ${meta.label}${countPart}${' '.repeat(Math.max(1, LABEL_WIDTH - meta.label.length - countPart.length))}${formatTime(elapsed)}`.padEnd(
          70,
        ) + '\n',
      );
    } else {
      const countPart = ` ${count}`;
      process.stdout.write(
        `  \u2713 ${meta.label}${countPart}${' '.repeat(Math.max(1, LABEL_WIDTH - meta.label.length - countPart.length))}${formatTime(elapsed)}\n`,
      );
    }
  }

  finish(processed: number, cached: number, formats?: string[]): void {
    const totalTime = performance.now() - this.t0;
    const formatCount = formats ? formats.length : 0;

    if (this.verbose) {
      process.stdout.write('\u25a0 Resultado\n\n');
      process.stdout.write(`  ${padRight('Documentos procesados', LABEL_WIDTH)} ${processed}\n`);
      process.stdout.write(`  ${padRight('Formatos generados', LABEL_WIDTH)} ${formatCount}\n`);
      process.stdout.write(`  ${padRight('Tiempo total', LABEL_WIDTH)} ${formatTime(totalTime)}\n\n`);
      process.stdout.write('\u2713 Todo listo.\n');
    } else {
      process.stdout.write(`\n\u2713 Todo listo.\n\n`);
      process.stdout.write(`  ${padRight('Documentos procesados', LABEL_WIDTH)}${processed}\n`);
      if (cached > 0) {
        process.stdout.write(`  ${padRight('Sin cambios (reutilizado)', LABEL_WIDTH)}${cached}\n`);
      }
      process.stdout.write(`  ${padRight('Formatos generados', LABEL_WIDTH)}${formatCount}\n`);
      process.stdout.write(`  ${padRight('Tiempo total', LABEL_WIDTH)}${formatTime(totalTime)}\n`);
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

  /** Renderiza la línea de progreso de la fase actual (solo TTY). */
  private renderPhaseLine(): void {
    const phase = this.currentPhase;
    if (!phase) return;
    const meta = PHASE_META[phase];
    const total = this.phaseCounts[phase] ?? 0;
    const count = this.currentPhaseCount;
    // El conteo se muestra solo cuando hay reportes (las fases sin notificaciones
    // por documento muestran la etiqueta sola hasta completarse).
    const progress = count > 0 && total > 0 ? ` [${Math.min(count, total)}/${total}]` : '';
    process.stdout.write(`\r  ${meta.label}${progress}`.padEnd(70));
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
