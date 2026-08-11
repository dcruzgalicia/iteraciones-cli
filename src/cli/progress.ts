import { GLYPHS, setWarningSink } from '../lib/logger.js';

function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Ancho mínimo para la columna de etiquetas en el resumen final. */
const LABEL_WIDTH = 30;

interface RenderFileReport {
  relativePath: string;
  phase: PipelinePhase;
}

type PipelinePhase = 'discovery' | 'render' | 'latex' | 'markdown' | 'pdf' | 'epub' | 'html';

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

/** Formatos ligeros generados dentro del pool 1 del pipeline (no fase separada). */
const LIGHT_FORMAT_PHASES: PipelinePhase[] = ['latex', 'html', 'epub', 'markdown'];

interface FormatState {
  phase: PipelinePhase;
  active: boolean;
}

type RowStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

interface Row {
  key: string;
  indent: number;
  label: string;
  status: RowStatus;
  count: number;
  elapsed?: number;
}

/**
 * Tracker de progreso del build con renderer propio.
 *
 * - **TTY**: filas interactivas con conteo en vivo [i/N] y re-render en sitio.
 * - **Non-TTY (pipes, CI)**: cada fila se imprime al finalizar, en el orden en
 *   que se cierra.
 * - **--verbose**: texto plano: las filas finales (con conteo y tiempo) y los [info] del orquestador.
 * - El resumen final (tabla alineada, advertencias, --profile) es idéntico.
 *
 * El renderer es síncrono y sin bucles de render: un error del build nunca
 * puede dejar el proceso colgado (regresiones #1211 resueltas por diseño,
 * no por coordinación de promesas).
 */
export class ProgressTracker {
  private t0: number;
  private phaseDurations: Partial<Record<PipelinePhase, number>> = {};
  private phaseCounts: Partial<Record<PipelinePhase, number>> = {};
  private currentPhase: PipelinePhase | null = null;
  private phaseStart: Partial<Record<PipelinePhase, number>> = {};
  private phaseDone: Set<PipelinePhase> = new Set();
  private currentPhaseCount = 0;
  /** Si true, escribe el desglose de tiempos por fase tras el resumen (--profile). */
  private profile: boolean;
  /** Modo --verbose: texto plano con etiquetas. */
  private verbose: boolean;
  /** Render interactivo (TTY) o impresión de estados finales. */
  private tty: boolean;
  /** Formatos configurados del proyecto (para las filas del grupo de formatos). */
  private formats: FormatState[] = [];
  /** Fases que el build ejecutará (declaradas por planPhases). */
  private usedPhases: Set<PipelinePhase> = new Set();
  /** Warnings diferidos (modo no verbose) para mostrar en el resumen final. */
  private warnings: string[] = [];

  // ── Renderer: filas en orden de aparición ──
  private rows: Row[] = [];
  private rowIndex = new Map<string, number>();
  private nextLine = 0;
  /** Línea real del cursor (0-based). Invariante: toda operación termina con el cursor en la última línea escrita y columna 0. */
  private cursorLine = 0;
  private formatsShown = false;

  constructor(options: { renderer?: 'default' | 'verbose' | 'test'; profile?: boolean } = {}) {
    this.verbose = options.renderer === 'verbose';
    this.tty = options.renderer === 'default' && process.stdout.isTTY === true;
    this.profile = options.profile ?? false;
    this.t0 = performance.now();
    if (options.renderer === 'default') {
      // Restaurar el cursor si el proceso sale sin completar (errores del build)
      process.once('exit', () => process.stdout.write('\x1b[?25h'));
      // Diferir warnings al resumen final para no interferir con el render
      setWarningSink((message) => this.warnings.push(message));
    }
  }

  /** Mensajes informativos del orquestador (visibles en --verbose). */
  log(msg: string): void {
    if (this.verbose) process.stdout.write(`[info] ${msg}\n`);
  }

  /**
   * Declara las fases que el build ejecutará. Debe llamarse antes de que el
   * render finalice: las fases no declaradas se muestran como omitidas.
   */
  async planPhases(phases: PipelinePhase[]): Promise<void> {
    for (const phase of phases) this.usedPhases.add(phase);
  }

  startPhase(phase: PipelinePhase, total: number = 0): void {
    this.currentPhase = phase;
    this.phaseCounts[phase] = total;
    this.phaseStart[phase] = performance.now();
    this.currentPhaseCount = 0;
    this.ensurePhaseRow(phase);
    // Las fases de formato (pdf) muestran su fila dentro del grupo de formatos
    if (phase !== 'discovery' && phase !== 'render') this.ensureFormatsBlock();
    this.setRowStatus(this.rowKeyFor(phase), 'active');
    this.renderRow(this.rowKeyFor(phase));
  }

  reportFile(file: RenderFileReport): void {
    // Progreso en vivo: cada documento completado actualiza la fila de su fase
    if (file.phase !== this.currentPhase) return;
    this.currentPhaseCount++;
    const row = this.getRow(this.rowKeyFor(file.phase));
    if (row?.status !== 'active') return;
    const total = this.phaseCounts[file.phase] ?? 0;
    const live = total > 0 ? `[${Math.min(this.currentPhaseCount, total)}/${total}]` : '';
    this.renderRow(this.rowKeyFor(file.phase), live);
  }

  completePhase(actualCount?: number, phaseOverride?: PipelinePhase): void {
    const phase = phaseOverride ?? this.currentPhase;
    if (!phase || this.phaseDone.has(phase)) return;
    this.phaseDone.add(phase);

    const st = this.phaseStart[phase];
    const elapsed = st !== undefined ? performance.now() - st : 0;
    this.phaseDurations[phase] = elapsed;
    const count = actualCount ?? this.phaseCounts[phase] ?? this.currentPhaseCount;
    this.phaseCounts[phase] = count;

    const key = this.rowKeyFor(phase);
    // El bloque de formatos solo se crea cuando el trabajo de un formato
    // comienza o termina (nunca al completar discovery/render).
    if (phase !== 'discovery' && phase !== 'render') this.ensureFormatsBlock();
    this.setRowStatus(key, 'done', count, elapsed);
    this.renderRow(key);
    if (phase === 'pdf') this.maybeFinishGroup();
  }

  async finish(processed: number, cached: number, formats?: string[], outputDir?: string): Promise<void> {
    this.finalizePendingRows(cached);
    this.writeSummary(processed, cached, formats, outputDir);
    setWarningSink(null);
  }

  /**
   * Cierra el tracker cuando el build falla (sin resumen: el error ya se
   * reportó). La fase activa se marca como fallida (✖); las fases no
   * iniciadas no muestran estado de éxito.
   */
  async fail(): Promise<void> {
    // La fase activa al fallar se marca como fallida, no como completada
    if (this.currentPhase) {
      const key = this.rowKeyFor(this.currentPhase);
      const row = this.getRow(key);
      if (row && row.status === 'active') {
        row.status = 'failed';
        const st = this.phaseStart[this.currentPhase];
        row.elapsed = st !== undefined ? performance.now() - st : 0;
        this.renderRow(key);
      }
    }
    // Fases no iniciadas: nunca muestran estado de éxito
    const renderRow = this.getRow('phase:render');
    if (renderRow && renderRow.status === 'pending') {
      renderRow.status = 'skipped';
      this.renderRow('phase:render');
    }
    this.ensureFormatsBlock();
    // Las filas de formato pendientes quedan sin imprimir: no son un éxito
    setWarningSink(null);
  }

  showCleanup(): void {
    if (this.verbose) process.stdout.write('[info] Archivos temporales limpiados\n');
  }

  /**
   * Declara los formatos configurados del proyecto (generate:true/false).
   * Debe llamarse antes del primer startPhase: las filas del grupo
   * 'Generando formatos' se crean a partir de esta lista.
   */
  setFormats(formats: FormatState[]): void {
    this.formats = formats;
  }

  /**
   * Marca el inicio de los formatos ligeros (latex, html, epub, markdown)
   * sin cambiar la fase activa: su trabajo ocurre dentro del pool 1 del
   * pipeline, cuyo progreso en vivo se reporta bajo 'render'.
   */
  startLightFormats(): void {
    const now = performance.now();
    for (const phase of LIGHT_FORMAT_PHASES) {
      this.phaseStart[phase] = now;
    }
  }

  // ── Renderer ──────────────────────────────────────────────────────────────

  private rowKeyFor(phase: PipelinePhase): string {
    return phase === 'discovery' || phase === 'render' ? `phase:${phase}` : `fmt:${phase}`;
  }

  private getRow(key: string): Row | undefined {
    return this.rows.find((row) => row.key === key);
  }

  /** Crea la fila de una fase de pipeline; discovery crea también la de render. */
  private ensurePhaseRow(phase: PipelinePhase): void {
    if (this.getRow(`phase:${phase}`)) return;
    const row: Row = { key: `phase:${phase}`, indent: 0, label: PHASE_META[phase].label, status: 'pending', count: 0 };
    this.rows.push(row);
    if (phase === 'discovery') {
      // La fila de render siempre existe: se muestra como omitida si no se planifica
      const renderRow: Row = { key: 'phase:render', indent: 0, label: PHASE_META.render.label, status: 'pending', count: 0 };
      this.rows.push(renderRow);
    }
  }

  /**
   * Crea el grupo 'Generando formatos' y las filas de los 5 formatos
   * configurados (activos → pendientes; desactivados → omitidos). El grupo
   * se omite completo si ningún formato está activo.
   */
  private ensureFormatsBlock(): void {
    if (this.formatsShown) return;
    if (!this.formats.some((f) => f.active)) return;
    this.formatsShown = true;
    const group: Row = { key: 'group', indent: 0, label: 'Generando formatos', status: 'active', count: 0 };
    this.rows.push(group);
    for (const f of this.formats) {
      const row: Row = {
        key: `fmt:${f.phase}`,
        indent: 1,
        label: f.active ? PHASE_META[f.phase].label : `${PHASE_META[f.phase].label} (desactivado)`,
        status: f.active ? 'pending' : 'skipped',
        count: 0,
      };
      this.rows.push(row);
      if (!f.active) this.renderRow(row.key);
    }
  }

  /** Marca el grupo como completado cuando todas las filas de formato se cerraron. */
  private maybeFinishGroup(): void {
    const group = this.getRow('group');
    if (!group || group.status === 'done') return;
    const allClosed = this.formats.every((f) => {
      const row = this.getRow(`fmt:${f.phase}`);
      return row !== undefined && row.status !== 'pending';
    });
    if (allClosed) {
      group.status = 'done';
      this.renderRow('group');
    }
  }

  /** Cierra filas pendientes al final del tracker (finish/fail). */
  private finalizePendingRows(cached = 0): void {
    const renderRow = this.getRow('phase:render');
    if (renderRow && renderRow.status === 'pending') {
      renderRow.status = 'skipped';
      this.renderRow('phase:render');
    }
    this.ensureFormatsBlock();
    for (const f of this.formats) {
      const row = this.getRow(`fmt:${f.phase}`);
      if (row && row.status === 'pending' && f.active) {
        // Sin trabajo para este formato en este build. Con salida previa
        // reutilizada el estado es honesto; sin caché (proyecto vacío) no se
        // afirma nada.
        row.status = 'skipped';
        if (cached > 0) row.label = `${PHASE_META[f.phase].label} (reutilizado)`;
        this.renderRow(row.key);
      }
    }
    this.maybeFinishGroup();
  }

  private setRowStatus(key: string, status: RowStatus, count = 0, elapsed?: number): void {
    const row = this.getRow(key);
    if (!row) return;
    row.status = status;
    row.count = count;
    row.elapsed = elapsed;
  }

  private rowContent(row: Row, live?: string): string {
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
    const timePart = row.elapsed !== undefined ? `  ${formatTime(row.elapsed)}` : '';
    const livePart = live !== undefined ? ` ${live}` : '';
    return `${indent}${prefix}${row.label}${countPart}${timePart}${livePart}`;
  }

  /**
   * Escribe (o actualiza) la fila. En TTY las filas activas se re-renderizan en
   * sitio; en non-TTY solo se imprimen los estados finales (done/skipped).
   *
   * El posicionamiento TTY usa `cursorLine` (la línea real del cursor), no
   * `nextLine`: tras una actualización en sitio el cursor NO está al final, y
   * un `up` calculado contra nextLine subiría de más (la fila se escribía en
   * una línea equivocada). El `\r` final restaura la columna 0 tras `B`
   * (`2K` no mueve el cursor y `B` tampoco): sin él, la siguiente escritura
   * empezaba en la columna residual del contenido anterior (indentaciones
   * fantasma en TTY, regresión #1536 incompleta).
   */
  private renderRow(key: string, live?: string): void {
    const row = this.getRow(key);
    if (!row || row.status === 'pending') return;
    const content = this.rowContent(row, live);
    const idx = this.rowIndex.get(key);
    if (this.tty) {
      if (idx === undefined) {
        process.stdout.write(`${content}\n`);
        this.rowIndex.set(key, this.nextLine);
        this.nextLine++;
        this.cursorLine = this.nextLine;
      } else {
        // Invariante: el cursor está en la última línea escrita, que es >= la
        // fila actualizada (la fila ya fue escrita antes).
        const up = this.cursorLine - idx;
        process.stdout.write(`\x1b[${up}A\x1b[2K\r${content}\x1b[${up}B\r`);
      }
    } else if (idx === undefined && (row.status === 'done' || row.status === 'skipped' || row.status === 'failed')) {
      process.stdout.write(`${content}\n`);
      this.rowIndex.set(key, this.nextLine++);
    }
  }

  private writeSummary(processed: number, cached: number, formats?: string[], outputDir?: string): void {
    const totalTime = performance.now() - this.t0;
    const formatCount = formats ? formats.length : 0;
    // "✔ Todo listo." solo sin advertencias: con warnings (p. ej. proyecto
    // vacío) el cierre es neutral para no contradecir el estado del build.
    if (this.warnings.length === 0) {
      process.stdout.write(`\n${GLYPHS.success} Todo listo.\n\n`);
    } else {
      process.stdout.write(`\n`);
    }

    process.stdout.write(`  ${padRight('Documentos procesados', LABEL_WIDTH)}${processed}\n`);
    if (cached > 0) {
      process.stdout.write(`  ${padRight('Sin cambios (reutilizado)', LABEL_WIDTH)}${cached}\n`);
    }
    // Conteo honesto: formatos ACTIVOS de la configuración (no archivos
    // generados, que dependen de cuántos documentos tengan salida), con el
    // desglose de documentos procesados por formato (solo si hubo trabajo).
    const formatDetail = processed > 0 && formats ? formats.map((f) => `${f} ${this.phaseCounts[f as PipelinePhase] ?? 0}`).join(', ') : '';
    process.stdout.write(`  ${padRight('Formatos activos', LABEL_WIDTH)}${formatCount}${formatDetail ? ` — ${formatDetail}` : ''}\n`);
    if (outputDir) {
      process.stdout.write(`  ${padRight('Salida', LABEL_WIDTH)}${outputDir}\n`);
    }
    process.stdout.write(`  ${padRight('Tiempo total', LABEL_WIDTH)}${formatTime(totalTime)}\n`);
    if (this.warnings.length > 0) {
      process.stdout.write(`\nAdvertencias:\n`);
      for (const warning of this.warnings) {
        process.stdout.write(`  ${warning}\n`);
      }
    }
    if (this.profile) {
      process.stdout.write(`\nPerfil de fases:\n`);
      const order: PipelinePhase[] = ['discovery', 'render', 'latex', 'pdf', 'html', 'epub', 'markdown'];
      for (const phase of order) {
        const ms = this.phaseDurations[phase];
        if (ms !== undefined) {
          process.stdout.write(`  ${padRight(PHASE_META[phase].label, LABEL_WIDTH)}${formatTime(ms)}\n`);
        }
      }
    }
  }
}

function padRight(s: string, w: number): string {
  return s.length < w ? s + ' '.repeat(w - s.length) : s;
}
