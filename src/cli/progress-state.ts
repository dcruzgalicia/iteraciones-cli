import type { FormatState, PipelinePhase } from '../builder/types.js';

export type { FormatState, PipelinePhase };

interface PhaseMeta {
  label: string;
}

const PHASE_META: Record<PipelinePhase, PhaseMeta> = {
  discovery: { label: 'Documentos encontrados' },
  render: { label: 'Renderizando contenido' },
  latex: { label: 'LaTeX' },
  pdf: { label: 'PDF' },
  html: { label: 'HTML' },
  epub: { label: 'EPUB' },
  markdown: { label: 'Markdown' },
};

const LIGHT_FORMAT_PHASES: PipelinePhase[] = ['latex', 'html', 'epub', 'markdown'];

function rowKeyToPhase(key: string): PipelinePhase {
  return (key.startsWith('phase:') ? key.slice(6) : key.slice(4)) as PipelinePhase;
}

type RowStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface RowState {
  key: string;
  indent: number;
  label: string;
  status: RowStatus;
  count: number;
  elapsed?: number;
}

interface PhaseTiming {
  start?: number;
  count?: number;
  live?: number;
  done: boolean;
}

export class TrackerState {
  rows: RowState[] = [];
  formats: FormatState[] = [];
  warnings: string[] = [];
  summaryLines: string[] = [];
  currentPhase: PipelinePhase | null = null;
  currentPhaseCount = 0;
  formatsShown = false;
  private phases = new Map<PipelinePhase, PhaseTiming>();

  getRow(key: string): RowState | undefined {
    return this.rows.find((row) => row.key === key);
  }

  rowKeyFor(phase: PipelinePhase): string {
    return phase === 'discovery' || phase === 'render' ? `phase:${phase}` : `fmt:${phase}`;
  }

  isPhaseDone(phase: PipelinePhase): boolean {
    return this.phases.get(phase)?.done ?? false;
  }

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

  startLightFormats(now: number): void {
    for (const phase of LIGHT_FORMAT_PHASES) {
      this.timing(phase).start = now;
    }
  }

  private ensurePhaseRow(phase: PipelinePhase): void {
    if (this.getRow(`phase:${phase}`)) return;
    this.rows.push({ key: `phase:${phase}`, indent: 0, label: PHASE_META[phase].label, status: 'pending', count: 0 });
    if (phase === 'discovery') {
      this.rows.push({ key: 'phase:render', indent: 0, label: PHASE_META.render.label, status: 'pending', count: 0 });
    }
  }

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

  phaseLive(phase: PipelinePhase): number {
    return this.phases.get(phase)?.live ?? 0;
  }

  reportFile(phase: PipelinePhase): boolean {
    const t = this.timing(phase);
    t.live = (t.live ?? 0) + 1;
    if (phase === this.currentPhase) this.currentPhaseCount++;
    const row = this.getRow(this.rowKeyFor(phase));
    return row?.status === 'active';
  }

  completePhase(phase: PipelinePhase, actualCount?: number): boolean {
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

  failActiveRows(): string[] {
    const keys: string[] = [];
    for (const row of this.rows) {
      if (row.status !== 'active' || row.key === 'group') continue;
      row.status = 'failed';
      const phase = rowKeyToPhase(row.key);
      const st = this.phases.get(phase)?.start;
      row.elapsed = st !== undefined ? performance.now() - st : 0;
      keys.push(row.key);
    }
    return keys;
  }

  skipPendingRenderRow(): boolean {
    const row = this.getRow('phase:render');
    if (row && row.status === 'pending') {
      row.status = 'skipped';
      return true;
    }
    return false;
  }

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

  finalizePending(cached = 0): string[] {
    const toRender: string[] = [];
    if (this.skipPendingRenderRow()) toRender.push('phase:render');
    const created = this.createFormatsBlock();
    for (const f of this.formats) {
      const row = this.getRow(`fmt:${f.phase}`);
      if (!row) continue;
      if (created && row.status === 'skipped' && !f.active) {
        toRender.push(row.key);
      } else if (row.status === 'pending' && f.active) {
        row.status = 'skipped';
        if (cached > 0) row.label = `${PHASE_META[f.phase].label} (reutilizado)`;
        toRender.push(row.key);
      }
    }
    if (this.maybeFinishGroup()) toRender.push('group');
    return toRender;
  }
}
