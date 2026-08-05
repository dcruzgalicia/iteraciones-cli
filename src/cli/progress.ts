import type { ListrDefaultRenderer, ListrTask, ListrTaskWrapper } from 'listr2';
import { type DefaultRenderer, Listr, type ListrRendererValue } from 'listr2';

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

const FORMAT_PHASES: PipelinePhase[] = ['latex', 'markdown', 'html', 'epub', 'pdf'];

type ListrCtx = Record<string, never>;
type TrackerTask = ListrTaskWrapper<ListrCtx, ListrDefaultRenderer, ListrDefaultRenderer>;

/**
 * Tracker de progreso del build basado en listr2.
 *
 * - **TTY**: renderer `default` (tareas animadas con conteo en vivo [i/N]).
 *   listr2 cae automáticamente al fallback SimpleRenderer en non-TTY (pipes y
 *   CI, uso automático sin interacción) — no hay lógica dual manual.
 * - **--verbose**: renderer `verbose` (texto plano).
 * - Las 7 fases se pre-registran al primer startPhase: listr2 no procesa
 *   tareas agregadas después de la primera. Las no usadas se saltan con
 *   `skip`, evaluado cuando el runner llega a ellas — sin carrera porque la
 *   tarea discovery se libera en `planPhases()`, cuando el orquestador ya
 *   conoce todas las fases del build.
 */
export class ProgressTracker {
  private t0: number;
  private phaseDurations: Partial<Record<PipelinePhase, number>> = {};
  private phaseCounts: Partial<Record<PipelinePhase, number>> = {};
  private currentPhase: PipelinePhase | null = null;
  private phaseStart: Partial<Record<PipelinePhase, number>> = {};
  private phaseDone: Set<PipelinePhase> = new Set();
  /** Documentos reportados en la fase actual (progreso en vivo). */
  private currentPhaseCount = 0;

  // ── listr2 ────────────────────────────────────────────────────────────────
  private renderer: ListrRendererValue;
  private listr: Listr<ListrCtx, ListrDefaultRenderer> | null = null;
  private runPromise: Promise<unknown> | null = null;
  private listrTasks: Map<PipelinePhase, TrackerTask> = new Map();
  private phaseResolvers: Map<PipelinePhase, () => void> = new Map();
  private usedPhases: Set<PipelinePhase> = new Set();
  private runnerAlive = false;
  private runnerDone = false;
  /** finish() ya se ejecutó: las tareas registradas después se resuelven al momento. */
  private finished = false;
  /** Mensajes informativos acumulados para mostrar en la primera tarea. */
  private infoMessages: string[] = [];

  constructor(options: { renderer?: 'default' | 'verbose' | 'test' } = {}) {
    this.renderer = (options.renderer ?? 'default') as ListrRendererValue;
    this.t0 = performance.now();
    if (this.renderer === 'default') {
      // Restaurar el cursor si el proceso sale sin completar run() (errores del build)
      process.once('exit', () => process.stdout.write('\x1b[?25h'));
    }
  }

  log(msg: string): void {
    // Acumular mensajes hasta que listr2 esté listo; luego emitirlos como output
    // de la primera tarea activa (discovery)
    if (this.runnerAlive) {
      const task = this.listrTasks.get('discovery');
      if (task) {
        task.output = msg;
        return;
      }
    }
    this.infoMessages.push(msg);
  }

  /**
   * Declara las fases que el build ejecutará. Debe llamarse después de que el
   * orquestador conozca los conjuntos de trabajo y antes del render. Espera a
   * que el runner procese discovery (en TTY el render() del DefaultRenderer es
   * async y retrasa el arranque) y libera su Promise para que los skips se
   * evalúen con la información completa.
   */
  async planPhases(phases: PipelinePhase[]): Promise<void> {
    for (const phase of phases) this.usedPhases.add(phase);
    if (!this.listr) return;
    // Esperar a que el runner registre discovery (en TTY el render() del
    // DefaultRenderer es async y retrasa el arranque); runnerDone cubre el
    // caso de runner roto.
    while (!this.phaseResolvers.has('discovery') && !this.runnerDone) {
      await Bun.sleep(5);
    }
    this.phaseResolvers.get('discovery')?.();
    this.phaseResolvers.delete('discovery');
  }

  startPhase(phase: PipelinePhase, total: number = 0): void {
    this.currentPhase = phase;
    this.phaseCounts[phase] = total;
    this.phaseStart[phase] = performance.now();
    this.currentPhaseCount = 0;
    if (!this.listr) this.createListr();
  }

  reportFile(file: RenderFileReport): void {
    // Progreso en vivo: cada documento completado actualiza la tarea de su fase
    if (file.phase === this.currentPhase) {
      this.currentPhaseCount++;
      const task = this.listrTasks.get(file.phase);
      if (task) {
        const total = this.phaseCounts[file.phase] ?? 0;
        task.output = total > 0 ? `[${Math.min(this.currentPhaseCount, total)}/${total}]` : '';
      }
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

    const task = this.listrTasks.get(phase);
    if (task) {
      const countPart = count > 0 ? ` ${count}` : '';
      task.title = `${meta.label}${countPart}  ${formatTime(elapsed)}`;
    }
    // Resolver la fase para que el runner avance (discovery la resuelve planPhases)
    if (phase !== 'discovery') {
      this.phaseResolvers.get(phase)?.();
      this.phaseResolvers.delete(phase);
    }
  }

  async finish(processed: number, cached: number, formats?: string[]): Promise<void> {
    this.finished = true;
    // Esperar a que el runner procese la primera tarea (en TTY el render() del
    // DefaultRenderer es async y retrasa el procesamiento); runnerDone cubre el
    // caso de runner roto. Luego resolver lo que quede pendiente (p. ej.
    // discovery en early returns).
    while (!this.runnerAlive && !this.runnerDone && this.listr) {
      await Bun.sleep(5);
    }
    this.phaseResolvers.forEach((resolve) => {
      resolve();
    });
    this.phaseResolvers.clear();
    await this.runPromise?.catch(() => {});
    this.writeSummary(processed, cached, formats);
  }

  /**
   * Resuelve las fases pendientes y espera al runner cuando el build falla.
   * En TTY el render loop del DefaultRenderer mantiene el proceso vivo mientras
   * run() no termine, así que sin esto el proceso quedaría bloqueado tras el
   * error (regresión #1211). No escribe el resumen: el error ya se reportó.
   */
  async fail(): Promise<void> {
    this.finished = true;
    this.phaseResolvers.forEach((resolve) => {
      resolve();
    });
    this.phaseResolvers.clear();
    await this.runPromise?.catch(() => {});
  }

  showCleanup(): void {
    this.infoMessages.push('Archivos temporales limpiados');
  }

  /** Crea la lista de listr2 con las 7 fases pre-registradas. */
  private createListr(): void {
    // Volcar mensajes informativos acumulados como output de la tarea discovery
    const discoveryTask = this.makeTask('discovery');
    if (this.infoMessages.length > 0) {
      const originalTask = discoveryTask.task;
      discoveryTask.task = (_ctx, task) => {
        task.output = this.infoMessages.join('\n');
        this.infoMessages = [];
        return typeof originalTask === 'function' ? originalTask(_ctx, task) : undefined;
      };
    }
    const subtasks: ListrTask<ListrCtx, ListrDefaultRenderer>[] = FORMAT_PHASES.map((phase) => this.makeTask(phase));

    this.listr = new Listr<ListrCtx, ListrDefaultRenderer>(
      [
        discoveryTask,
        this.makeTask('render'),
        {
          title: 'Generando formatos',
          skip: () => !FORMAT_PHASES.some((phase) => this.usedPhases.has(phase)),
          task: (_ctx, task) => task.newListr(subtasks, { concurrent: true }),
        },
      ],
      { renderer: this.renderer as unknown as typeof DefaultRenderer, rendererOptions: { clearOutput: false, collapseSubtasks: false } },
    );
    this.runPromise = this.listr.run().then(
      () => {
        this.runnerDone = true;
      },
      () => {
        this.runnerDone = true;
      },
    );
  }

  /** Crea una tarea de fase con Promise controlada y skip según las fases planificadas. */
  private makeTask(phase: PipelinePhase): ListrTask<ListrCtx, ListrDefaultRenderer> {
    const title = PHASE_META[phase].label;
    // discovery siempre corre; el resto solo si está en usedPhases (planPhases)
    const skip = phase === 'discovery' ? () => false : () => !this.usedPhases.has(phase);
    return {
      title,
      skip,
      task: (_ctx, task) =>
        new Promise<void>((resolve) => {
          this.runnerAlive = true;
          this.listrTasks.set(phase, task);
          this.phaseResolvers.set(phase, resolve);
          // Si finish() ya pasó (el runner se retrasó, p. ej. render() async del
          // DefaultRenderer en TTY), resolver al momento para no colgar run().
          if (this.finished) resolve();
        }),
    };
  }

  private writeSummary(processed: number, cached: number, formats?: string[]): void {
    const totalTime = performance.now() - this.t0;
    const formatCount = formats ? formats.length : 0;

    process.stdout.write(`\n\u2713 Todo listo.\n\n`);
    process.stdout.write(`  ${padRight('Documentos procesados', LABEL_WIDTH)}${processed}\n`);
    if (cached > 0) {
      process.stdout.write(`  ${padRight('Sin cambios (reutilizado)', LABEL_WIDTH)}${cached}\n`);
    }
    process.stdout.write(`  ${padRight('Formatos generados', LABEL_WIDTH)}${formatCount}\n`);
    process.stdout.write(`  ${padRight('Tiempo total', LABEL_WIDTH)}${formatTime(totalTime)}\n`);
  }
}

function padRight(s: string, w: number): string {
  return s.length < w ? s + ' '.repeat(w - s.length) : s;
}
