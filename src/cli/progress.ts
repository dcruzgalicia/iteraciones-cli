import { join } from 'node:path';
import { GLYPHS } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { type FormatState, type PipelinePhase, type RowState, TrackerState } from './progress-state.js';

export type { FormatState, PipelinePhase, RowState, RowStatus } from './progress-state.js';

function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

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
 * (progress-state.ts): el renderer solo decide cuándo y cómo escribir, cada
 * transición de estado devuelve exactamente las claves que debe re-renderizar.
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

  // ── Marcas de escritura del renderer (líneas reales del terminal) ──
  private rowIndex = new Map<string, number>();
  private nextLine = 0;
  /** Línea real del cursor (0-based). Invariante: toda operación termina con el cursor en la última línea escrita y columna 0. */
  private cursorLine = 0;

  constructor(options: { renderer?: 'default' | 'verbose' | 'test'; stream?: NodeJS.WriteStream; tty?: boolean } = {}) {
    this.verbose = options.renderer === 'verbose';
    this.stream = options.stream ?? process.stdout;
    // tty forzado en tests (sin tocar process.stdout.isTTY) o derivado del stream
    this.tty = options.tty ?? (options.renderer === 'default' && this.stream.isTTY === true);
    this.state = new TrackerState();
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
    if (created) this.renderInactiveFormatRows();
    this.renderRow(this.state.rowKeyFor(phase));
  }

  reportFile(file: RenderFileReport): void {
    // Progreso en vivo: cada documento completado actualiza la fila de su fase
    if (file.phase !== this.state.currentPhase) return;
    if (!this.state.reportFile(file.phase)) return;
    const total = this.state.phaseCount(file.phase);
    const live = total > 0 ? `[${Math.min(this.state.currentPhaseCount, total)}/${total}]` : '';
    this.renderRow(this.state.rowKeyFor(file.phase), live);
  }

  completePhase(actualCount?: number, phaseOverride?: PipelinePhase): void {
    const phase = phaseOverride ?? this.state.currentPhase;
    if (!phase || this.state.isPhaseDone(phase)) return;
    const created = this.state.completePhase(phase, actualCount);
    if (created) this.renderInactiveFormatRows();
    this.renderRow(this.state.rowKeyFor(phase));
    if (phase === 'pdf' && this.state.maybeFinishGroup()) this.renderRow('group');
  }

  async finish(processed: number, cached: number, formats?: string[], outputDir?: string): Promise<void> {
    for (const key of this.state.finalizePending(cached)) this.renderRow(key);
    await this.writeSummary(processed, cached, formats, outputDir);
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
      if (this.state.failActiveRow(this.state.currentPhase)) this.renderRow(key);
    }
    // Fases no iniciadas: nunca muestran estado de éxito
    if (this.state.skipPendingRenderRow()) this.renderRow('phase:render');
    const created = this.state.createFormatsBlock();
    if (created) this.renderInactiveFormatRows();
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

  // ── Renderer ──────────────────────────────────────────────────────────────

  /** Imprime las filas de formatos desactivados al materializarse el bloque. */
  private renderInactiveFormatRows(): void {
    for (const f of this.state.formats) {
      const row = this.state.getRow(`fmt:${f.phase}`);
      if (row && row.status === 'skipped') this.renderRow(row.key);
    }
  }

  private rowContent(row: RowState, live?: string): string {
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
    const row = this.state.getRow(key);
    if (!row || row.status === 'pending') return;
    const content = this.rowContent(row, live);
    const idx = this.rowIndex.get(key);
    if (this.tty) {
      if (idx === undefined) {
        this.stream.write(`${content}\n`);
        this.rowIndex.set(key, this.nextLine);
        this.nextLine++;
        this.cursorLine = this.nextLine;
      } else {
        // Invariante: el cursor está en la última línea escrita, que es >= la
        // fila actualizada (la fila ya fue escrita antes).
        const up = this.cursorLine - idx;
        this.stream.write(`\x1b[${up}A\x1b[2K\r${content}\x1b[${up}B\r`);
      }
    } else if (idx === undefined && (row.status === 'done' || row.status === 'skipped' || row.status === 'failed')) {
      this.stream.write(`${content}\n`);
      this.rowIndex.set(key, this.nextLine++);
    }
  }

  private async writeSummary(processed: number, cached: number, formats?: string[], outputDir?: string): Promise<void> {
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
