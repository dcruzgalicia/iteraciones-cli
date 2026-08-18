import { join } from 'node:path';
import { GLYPHS } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { formatTime, TrackerRenderer } from './progress-render.js';
import { type FormatState, type PipelinePhase, type RowState, TrackerState } from './progress-state.js';

export type { FormatState, PipelinePhase, RowState, RowStatus } from './progress-state.js';

/** Ancho mínimo para la columna de etiquetas en el resumen final. */
const LABEL_WIDTH = 30;

interface RenderFileReport {
  relativePath: string;
  phase: PipelinePhase;
}

/**
 * Tracker de progreso del build con renderer propio.
 *
 * - **TTY**: filas interactivas con conteo en vivo [i/N] y re-render en sitio.
 * - **Non-TTY (pipes, CI)**: cada fila se imprime al finalizar, en el orden en
 *   que se cierra.
 * - **--verbose**: texto plano: las filas finales (con conteo y tiempo) y los [info] del orquestador.
 * - El resumen final (tabla alineada, advertencias) es idéntico.
 *
 * El renderer es síncrono y sin bucles de render: un error del build nunca
 * puede dejar el proceso colgado (regresiones #1211 resueltas por diseño,
 * no por coordinación de promesas).
 *
 * El estado de las filas (modelo declarativo puro) vive en `TrackerState`
 * (progress-state.ts) y la escritura ANSI en `TrackerRenderer`
 * (progress-render.ts): el tracker delega ambas, conservando solo el resumen
 * final y las decisiones de qué renderizar (cada transición de estado
 * devuelve exactamente las claves a re-renderizar).
 */
export class ProgressTracker {
  private t0: number;
  /** Modo --verbose: texto plano con etiquetas. */
  private verbose: boolean;
  /** Render interactivo (TTY) o impresión de estados finales. */
  private tty: boolean;
  /** Stream de salida (inyectable en tests; por defecto stdout). */
  private stream: NodeJS.WriteStream;
  /** Modelo declarativo del tracker: filas, fases, formatos y warnings. */
  private state: TrackerState;
  /** Único punto de escritura ANSI del tracker. */
  private renderer: TrackerRenderer;

  constructor(options: { renderer?: 'default' | 'verbose' | 'test'; stream?: NodeJS.WriteStream; tty?: boolean } = {}) {
    this.verbose = options.renderer === 'verbose';
    this.stream = options.stream ?? process.stdout;
    // tty forzado en tests (sin tocar process.stdout.isTTY) o derivado del stream
    this.tty = options.tty ?? (options.renderer === 'default' && this.stream.isTTY === true);
    this.state = new TrackerState();
    this.renderer = new TrackerRenderer(this.stream, this.tty);
    this.t0 = performance.now();
    if (options.renderer === 'default') {
      // Restaurar el cursor si el proceso sale sin completar (errores del build)
      process.once('exit', () => this.stream.write('\x1b[?25h'));
    }
  }

  /**
   * Acumula un warning para el resumen final (modo no verbose). El orquestador
   * conecta este método como sink de logWarning vía runWithWarningSink.
   */
  addWarning(message: string): void {
    this.state.addWarning(message);
  }

  /** Mensajes informativos del orquestador (visibles en --verbose). */
  log(msg: string): void {
    if (this.verbose) this.stream.write(`[info] ${msg}\n`);
  }

  /**
   * Declara las fases que el build ejecutará. Debe llamarse antes de que el
   * render finalice: las fases no declaradas se muestran como omitidas.
   */
  async planPhases(phases: PipelinePhase[]): Promise<void> {
    this.state.planPhases(phases);
  }

  startPhase(phase: PipelinePhase, total: number = 0): void {
    const created = this.state.startPhase(phase, total);
    // El bloque de formatos se imprime al materializarse (filas desactivadas)
    if (created) this.renderer.renderInactiveFormats(this.state);
    this.renderer.renderRow(this.state, this.state.rowKeyFor(phase));
  }

  reportFile(file: RenderFileReport): void {
    // Progreso en vivo: cada documento completado actualiza la fila de su fase
    if (file.phase !== this.state.currentPhase) return;
    if (!this.state.reportFile(file.phase)) return;
    const total = this.state.phaseCount(file.phase);
    const live = total > 0 ? `[${Math.min(this.state.currentPhaseCount, total)}/${total}]` : '';
    this.renderer.renderRow(this.state, this.state.rowKeyFor(file.phase), live);
  }

  completePhase(actualCount?: number, phaseOverride?: PipelinePhase): void {
    const phase = phaseOverride ?? this.state.currentPhase;
    if (!phase || this.state.isPhaseDone(phase)) return;
    const created = this.state.completePhase(phase, actualCount);
    if (created) this.renderer.renderInactiveFormats(this.state);
    this.renderer.renderRow(this.state, this.state.rowKeyFor(phase));
    if (phase === 'pdf' && this.state.maybeFinishGroup()) this.renderer.renderRow(this.state, 'group');
  }

  async finish(processed: number, cached: number, formats?: string[], outputDir?: string, invalidations?: string[]): Promise<void> {
    for (const key of this.state.finalizePending(cached)) this.renderer.renderRow(this.state, key);
    await this.writeSummary(processed, cached, formats, outputDir, invalidations);
  }

  /**
   * Cierra el tracker cuando el build falla (sin resumen: el error ya se
   * reportó). La fase activa se marca como fallida (✖); las fases no
   * iniciadas no muestran estado de éxito.
   */
  async fail(): Promise<void> {
    // La fase activa al fallar se marca como fallida, no como completada
    if (this.state.currentPhase) {
      const key = this.state.rowKeyFor(this.state.currentPhase);
      if (this.state.failActiveRow(this.state.currentPhase)) this.renderer.renderRow(this.state, key);
    }
    // Fases no iniciadas: nunca muestran estado de éxito
    if (this.state.skipPendingRenderRow()) this.renderer.renderRow(this.state, 'phase:render');
    const created = this.state.createFormatsBlock();
    if (created) this.renderer.renderInactiveFormats(this.state);
    // Las filas de formato pendientes quedan sin imprimir: no son un éxito
  }

  showCleanup(): void {
    if (this.verbose) this.stream.write('[info] Archivos temporales limpiados\n');
  }

  /**
   * Declara los formatos configurados del proyecto (generate:true/false).
   * Debe llamarse antes del primer startPhase: las filas del grupo
   * 'Generando formatos' se crean a partir de esta lista.
   */
  setFormats(formats: FormatState[]): void {
    this.state.setFormats(formats);
  }

  /**
   * Marca el inicio de los formatos ligeros (latex, html, epub, markdown)
   * sin cambiar la fase activa: su trabajo ocurre dentro del pool 1 del
   * pipeline, cuyo progreso en vivo se reporta bajo 'render'.
   */
  startLightFormats(): void {
    this.state.startLightFormats(performance.now());
  }

  // ── Resumen final (texto plano, sin ANSI) ─────────────────────────────────

  private async writeSummary(processed: number, cached: number, formats?: string[], outputDir?: string, invalidations?: string[]): Promise<void> {
    const totalTime = performance.now() - this.t0;
    const formatCount = formats ? formats.length : 0;
    // "✔ Todo listo." solo sin advertencias: con warnings (p. ej. proyecto
    // vacío) el cierre es neutral para no contradecir el estado del build.
    if (this.state.warnings.length === 0) {
      this.stream.write(`\n${GLYPHS.success} Todo listo.\n\n`);
    } else {
      this.stream.write(`\n`);
    }

    this.stream.write(`  ${padRight('Documentos procesados', LABEL_WIDTH)}${processed}\n`);
    if (cached > 0) {
      this.stream.write(`  ${padRight('Sin cambios (reutilizado)', LABEL_WIDTH)}${cached}\n`);
    }
    // Razón de invalidación en modo default: la caché es opaca si el usuario no
    // sabe por qué se reprocesaron (o no) los documentos. `undefined` conserva
    // el comportamiento previo (llamadas sin la información, p. ej. proyecto
    // vacío); una lista vacía significa caché completa.
    if (invalidations !== undefined) {
      const value =
        invalidations.length > 0
          ? `${invalidations.join(', ')} — reprocesados ${plural(processed, 'documento')}`
          : 'sin invalidaciones — todo desde caché';
      this.stream.write(`  ${padRight('Invalidación', LABEL_WIDTH)}${value}\n`);
    }
    // Conteo honesto: formatos ACTIVOS de la configuración (no archivos
    // generados, que dependen de cuántos documentos tengan salida), con el
    // desglose de documentos procesados por formato (solo si hubo trabajo).
    const formatDetail = processed > 0 && formats ? formats.map((f) => `${f} ${this.state.phaseCount(f as PipelinePhase)}`).join(', ') : '';
    this.stream.write(`  ${padRight('Formatos activos', LABEL_WIDTH)}${formatCount}${formatDetail ? ` — ${formatDetail}` : ''}\n`);
    if (outputDir) {
      this.stream.write(`  ${padRight('Salida', LABEL_WIDTH)}${outputDir}\n`);
    }
    this.stream.write(`  ${padRight('Tiempo total', LABEL_WIDTH)}${formatTime(totalTime)}\n`);
    // Guía post-build: sustituye al comando open eliminado. Solo cuando hubo
    // trabajo real (processed > 0) hay algo nuevo que abrir; el index.html es
    // la página de entrada cuando existe (index.md en la raíz) — sin él, se
    // abre el directorio de salida (la sugerencia nunca apunta a un archivo
    // inexistente).
    if (outputDir && processed > 0) {
      const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const indexHtml = join(outputDir, 'index.html');
      const target = (await Bun.file(indexHtml).exists()) ? indexHtml : outputDir;
      // start de Windows necesita el título de ventana como primer argumento
      // (vacío) y las comillas protegen rutas con espacios.
      const command = process.platform === 'win32' ? `start "" "${target}"` : `${opener} "${target}"`;
      this.stream.write(`  ${padRight('Abre el resultado', LABEL_WIDTH)}${command}\n`);
    }
    if (this.state.warnings.length > 0) {
      // Cierre explícito con el conteo y el siguiente paso: sin él, el build
      // con advertencias termina sin que el usuario sepa si "terminó bien"
      // (exit 0) y sin conectar con la herramienta de diagnóstico.
      this.stream.write(
        `\n${GLYPHS.warning} Build completado con ${plural(this.state.warnings.length, 'advertencia')}. Ejecuta 'iteraciones validate' para más detalle.\n`,
      );
      this.stream.write(`\nAdvertencias:\n`);
      for (const warning of this.state.warnings) {
        this.stream.write(`  ${warning}\n`);
      }
    }
  }
}

function padRight(text: string, width: number): string {
  return text.padEnd(width);
}
