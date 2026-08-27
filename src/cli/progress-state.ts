/**
 * Estado declarativo del tracker de progreso (parte 1 del refactor del
 * ProgressTracker).
 *
 * Este módulo contiene SOLO el modelo de datos del tracker: filas, fase
 * actual, cronometría y conteos por fase, formatos configurados, warnings
 * acumulados y las transiciones puras sobre ese modelo (registrar fila,
 * actualizar conteo, completar fase, fallar). Ningún método escribe en el
 * terminal: el renderer (ProgressTracker) consume el estado por consulta y
 * decide cuándo y cómo escribir cada fila. La parte 2 del refactor
 * concentrará toda la escritura ANSI en un único render.
 *
 * Las transiciones devuelven datos (claves a renderizar, booleanos de
 * cambio) en lugar de escribir: cada llamada al estado produce exactamente
 * una decisión de render en el caller, sin duplicar escrituras.
 *
 * PipelinePhase y FormatState viven en `builder/types.ts` (fuente única del
 * contrato BuildReporter, issue #2017); aquí se re-exportan para los
 * consumidores de la capa CLI.
 */

import type { FormatState, PipelinePhase } from '../builder/types.js';

export type { FormatState, PipelinePhase };

export interface PhaseMeta {
  label: string;
}

export const PHASE_META: Record<PipelinePhase, PhaseMeta> = {
  discovery: { label: 'Documentos encontrados' },
  render: { label: 'Renderizando contenido' },
  latex: { label: 'LaTeX' },
  pdf: { label: 'PDF' },
  html: { label: 'HTML' },
  epub: { label: 'EPUB' },
  markdown: { label: 'Markdown' },
};

/** Formatos ligeros generados dentro del pool 1 del pipeline (no fase separada). */
export const LIGHT_FORMAT_PHASES: PipelinePhase[] = ['latex', 'html', 'epub', 'markdown'];

export type RowStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface RowState {
  key: string;
  indent: number;
  label: string;
  status: RowStatus;
  count: number;
  elapsed?: number;
}

/** Cronometría y conteo por fase del pipeline. */
interface PhaseTiming {
  start?: number;
  count?: number;
  done: boolean;
}

export class TrackerState {
  /** Filas del tracker en orden de aparición. */
  rows: RowState[] = [];
  /** Formatos configurados del proyecto (generate:true/false). */
  formats: FormatState[] = [];
  /** Warnings diferidos (modo no verbose) para mostrar en el resumen final. */
  warnings: string[] = [];
  /** Líneas de confirmación extra del resumen final (p. ej. validación PDF/X-1a). */
  summaryLines: string[] = [];
  /** Fase activa del pipeline (iniciada con startPhase). */
  currentPhase: PipelinePhase | null = null;
  /** Conteo en vivo de documentos completados en la fase activa. */
  currentPhaseCount = 0;
  /** true si el grupo 'Generando formatos' ya se materializó en filas. */
  formatsShown = false;
  private phases = new Map<PipelinePhase, PhaseTiming>();

  // ── Consultas ─────────────────────────────────────────────────────────────

  getRow(key: string): RowState | undefined {
    return this.rows.find((row) => row.key === key);
  }

  /** Clave de fila de una fase: phase:render para pipeline, fmt:pdf para formatos. */
  rowKeyFor(phase: PipelinePhase): string {
    return phase === 'discovery' || phase === 'render' ? `phase:${phase}` : `fmt:${phase}`;
  }

  isPhaseDone(phase: PipelinePhase): boolean {
    return this.phases.get(phase)?.done ?? false;
  }

  /** Conteo de una fase: total planificado (tras startPhase) o real (tras completePhase). */
  phaseCount(phase: PipelinePhase): number {
    return this.phases.get(phase)?.count ?? 0;
  }

  private timing(phase: PipelinePhase): PhaseTiming {
    const existing = this.phases.get(phase);
    if (existing) return existing;
    const created: PhaseTiming = { done: false };
    this.phases.set(phase, created);
    return created;
  }

  // ── Transiciones puras (sin escritura en el stream) ──────────────────────

  /** Declara las fases que el build ejecutará (su cronometría queda registrada). */
  planPhases(phases: PipelinePhase[]): void {
    for (const phase of phases) this.timing(phase);
  }

  setFormats(formats: FormatState[]): void {
    this.formats = formats;
  }

  addWarning(message: string): void {
    this.warnings.push(message);
  }

  addSummaryLine(line: string): void {
    this.summaryLines.push(line);
  }

  /** Marca el inicio de los formatos ligeros (su trabajo ocurre dentro de render). */
  startLightFormats(now: number): void {
    for (const phase of LIGHT_FORMAT_PHASES) {
      this.timing(phase).start = now;
    }
  }

  /** Asegura la fila de una fase de pipeline; discovery crea también la de render. */
  private ensurePhaseRow(phase: PipelinePhase): void {
    if (this.getRow(`phase:${phase}`)) return;
    this.rows.push({ key: `phase:${phase}`, indent: 0, label: PHASE_META[phase].label, status: 'pending', count: 0 });
    if (phase === 'discovery') {
      // La fila de render siempre existe: se muestra como omitida si no se planifica
      this.rows.push({ key: 'phase:render', indent: 0, label: PHASE_META.render.label, status: 'pending', count: 0 });
    }
  }

  /**
   * Materializa el grupo 'Generando formatos' y las filas de los formatos
   * configurados (activos → pendientes; desactivados → omitidos). Retorna
   * false si el bloque ya existe o ningún formato está activo.
   */
  createFormatsBlock(): boolean {
    if (this.formatsShown) return false;
    if (!this.formats.some((f) => f.active)) return false;
    this.formatsShown = true;
    this.rows.push({ key: 'group', indent: 0, label: 'Generando formatos', status: 'active', count: 0 });
    for (const f of this.formats) {
      this.rows.push({
        key: `fmt:${f.phase}`,
        indent: 1,
        label: f.active ? PHASE_META[f.phase].label : `${PHASE_META[f.phase].label} (desactivado)`,
        status: f.active ? 'pending' : 'skipped',
        count: 0,
      });
    }
    return true;
  }

  /**
   * Inicia una fase: la marca como activa y prepara su fila. Retorna true si
   * el bloque de formatos se materializó aquí (el renderer imprime entonces
   * las filas de formatos desactivados).
   */
  startPhase(phase: PipelinePhase, total = 0): boolean {
    this.currentPhase = phase;
    const t = this.timing(phase);
    t.count = total;
    t.start = performance.now();
    this.currentPhaseCount = 0;
    this.ensurePhaseRow(phase);
    const created = phase !== 'discovery' && phase !== 'render' ? this.createFormatsBlock() : false;
    const row = this.getRow(this.rowKeyFor(phase));
    if (row) {
      row.status = 'active';
      row.count = 0;
      row.elapsed = undefined;
    }
    return created;
  }

  /**
   * Cuenta un documento completado de la fase activa. Retorna true si la fila
   * de la fase está activa (el renderer muestra entonces el progreso en vivo).
   */
  reportFile(phase: PipelinePhase): boolean {
    this.currentPhaseCount++;
    const row = this.getRow(this.rowKeyFor(phase));
    return row?.status === 'active';
  }

  /**
   * Completa una fase: registra duración y conteo reales y marca su fila como
   * done. Retorna true si el bloque de formatos se materializó aquí.
   */
  completePhase(phase: PipelinePhase, actualCount?: number): boolean {
    // El bloque de formatos se materializa antes de fijar la fila: la fila del
    // formato debe existir cuando se le asigna el estado done.
    const created = phase !== 'discovery' && phase !== 'render' ? this.createFormatsBlock() : false;
    const t = this.timing(phase);
    t.done = true;
    const elapsed = t.start !== undefined ? performance.now() - t.start : 0;
    const count = actualCount ?? t.count ?? this.currentPhaseCount;
    t.count = count;
    const row = this.getRow(this.rowKeyFor(phase));
    if (row) {
      row.status = 'done';
      row.count = count;
      row.elapsed = elapsed;
    }
    return created;
  }

  /** Marca la fase activa como fallida (✖). Retorna true si hubo cambio. */
  failActiveRow(phase: PipelinePhase): boolean {
    const row = this.getRow(this.rowKeyFor(phase));
    if (row?.status !== 'active') return false;
    row.status = 'failed';
    const st = this.phases.get(phase)?.start;
    row.elapsed = st !== undefined ? performance.now() - st : 0;
    return true;
  }

  /** Marca la fila de render pendiente como omitida (nunca un éxito). */
  skipPendingRenderRow(): boolean {
    const row = this.getRow('phase:render');
    if (row && row.status === 'pending') {
      row.status = 'skipped';
      return true;
    }
    return false;
  }

  /** Marca el grupo como completado cuando todas las filas de formato se cerraron. */
  maybeFinishGroup(): boolean {
    const group = this.getRow('group');
    if (!group || group.status === 'done') return false;
    const allClosed = this.formats.every((f) => {
      const row = this.getRow(`fmt:${f.phase}`);
      return row !== undefined && row.status !== 'pending';
    });
    if (allClosed) {
      group.status = 'done';
      return true;
    }
    return false;
  }

  /**
   * Cierra filas pendientes al final del tracker (finish). Devuelve las claves
   * de las filas que el renderer debe (re)imprimir, en orden de aparición.
   */
  finalizePending(cached = 0): string[] {
    const toRender: string[] = [];
    if (this.skipPendingRenderRow()) toRender.push('phase:render');
    const created = this.createFormatsBlock();
    if (created) {
      for (const f of this.formats) {
        const row = this.getRow(`fmt:${f.phase}`);
        if (row && row.status === 'skipped' && !f.active) toRender.push(row.key);
      }
    }
    for (const f of this.formats) {
      const row = this.getRow(`fmt:${f.phase}`);
      if (row && row.status === 'pending' && f.active) {
        // Sin trabajo para este formato en este build. Con salida previa
        // reutilizada el estado es honesto; sin caché (proyecto vacío) no se
        // afirma nada.
        row.status = 'skipped';
        if (cached > 0) row.label = `${PHASE_META[f.phase].label} (reutilizado)`;
        toRender.push(row.key);
      }
    }
    if (this.maybeFinishGroup()) toRender.push('group');
    return toRender;
  }
}
