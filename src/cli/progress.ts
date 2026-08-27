import { join } from 'node:path';
import { EMPTY_PROJECT_WARNING_INIT, EMPTY_PROJECT_WARNING_NO_DOCS } from '../builder/orchestrator.js';
import type { BuildReporter, RenderFileReport } from '../builder/types.js';
import { GLYPHS } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { formatTime, TrackerRenderer } from './progress-render.js';
import { type FormatState, type PipelinePhase, TrackerState } from './progress-state.js';

/** Ancho mínimo para la columna de etiquetas en el resumen final. */
const LABEL_WIDTH = 30;

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
export class ProgressTracker implements BuildReporter {
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
      // Restaurar el cursor si el proceso sale sin completar (errores del
      // build). Solo en TTY: en pipes escribir códigos de control ensuciaría
      // la salida capturada (issue #2029).
      if (this.tty) process.once('exit', () => this.stream.write('\x1b[?25h'));
    }
  }

  /**
   * Acumula un warning para el resumen final (modo no verbose). El orquestador
   * conecta este método como sink de logWarning vía runWithWarningSink.
   */
  addWarning(message: string): void {
    this.state.addWarning(message);
  }

  /**
   * Acumula una línea de confirmación para el resumen final (modo no verbose),
   * p. ej. "✔ Validación PDF/X-1a: …". Se imprime tras la tabla del resumen,
   * antes de las advertencias.
   */
  addSummaryLine(line: string): void {
    this.state.addSummaryLine(line);
  }

  /** Mensajes informativos del orquestador (visibles en --verbose). */
  log(msg: string): void {
    if (this.verbose) this.stream.write(`[info] ${msg}\n`);
  }

  /**
   * Declara las fases que el build ejecutará. Debe llamarse antes de que el
   * render finalice: las fases no declaradas se muestran como omitidas.
   */
  planPhases(phases: PipelinePhase[]): void {
    this.state.planPhases(phases);
  }

  startPhase(phase: PipelinePhase, total: number = 0): void {
    const created = this.state.startPhase(phase, total);
    // El bloque de formatos se imprime al materializarse (filas desactivadas)
    if (created) this.renderer.renderInactiveFormats(this.state);
    this.renderer.renderRow(this.state, this.state.rowKeyFor(phase));
  }

  reportFile(file: RenderFileReport): void {
    // Progreso en vivo POR FASE (#2171): el reporte se acepta si la fila de su
    // propia fase está activa — durante el solape render y pdf avanzan a la
    // vez; filtrar por la fase global descartaba el progreso del PDF.
    const row = this.state.getRow(this.state.rowKeyFor(file.phase));
    if (row?.status !== 'active') return;
    if (!this.state.reportFile(file.phase)) return;
    const total = this.state.phaseCount(file.phase);
    const live = this.state.phaseLive(file.phase);
    // Con el total aún desconocido (el pool 2 encola en vivo) se muestra solo
    // el avance: honesto, sin inventar un N.
    const label = total > 0 ? `[${Math.min(live, total)}/${total}]` : `[${live}]`;
    this.renderer.renderRow(this.state, this.state.rowKeyFor(file.phase), label);
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
    // Todas las fases activas se marcan fallidas: durante el solape hay dos
    // (render + pdf) y el fallo se atribuye a cada una (#2171).
    for (const key of this.state.failActiveRows()) {
      this.renderer.renderRow(this.state, key);
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

  /**
   * Compacta la lista de invalidaciones para el resumen (#2028): máximo 3
   * razones visibles; el resto se resume. El detalle completo sigue
   * disponible en --verbose y en el contrato --json (que no cambia).
   */
  static compactInvalidations(list: string[], max = 3, budget = 72): string {
    const parts: string[] = [];
    let used = 0;
    let included = 0;
    for (const reason of list) {
      const add = (included > 0 ? 2 : 0) + reason.length;
      // La primera razón entra siempre (aun larga): la línea nunca queda vacía
      if (included >= max || (included > 0 && used + add > budget)) break;
      parts.push(reason);
      used += add;
      included++;
    }
    const rest = list.length - included;
    return rest > 0 ? `${parts.join(', ')} … y ${rest} más (--verbose)` : parts.join(', ');
  }

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

    // Línea única de documentos sin cifras duplicadas (#2086): antes se
    // repetían tres veces (procesados / reutilizados / invalidación). La
    // razón de invalidación con causa única se pliega aquí; con causas
    // múltiples lleva línea propia para no ocultar ninguna.
    const total = processed + cached;
    let docsLine = `${padRight('Documentos', LABEL_WIDTH)}${total}`;
    if (processed > 0 && cached > 0) {
      docsLine += ` (${processed} ${plural(processed, 'modificado', 'modificados')} · ${cached} ${plural(cached, 'reutilizado', 'reutilizados')})`;
    } else if (total > 0 && processed === 0) {
      docsLine += ' (todos reutilizados)';
    } else if (cached === 0 && invalidations !== undefined && invalidations.length === 1) {
      docsLine += ` — ${ProgressTracker.compactInvalidations(invalidations)}`;
    }
    this.stream.write(`  ${docsLine}\n`);
    if (invalidations !== undefined && invalidations.length > 1) {
      this.stream.write(`  ${padRight('Invalidaciones', LABEL_WIDTH)}${ProgressTracker.compactInvalidations(invalidations)}\n`);
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
    // Líneas de confirmación del resumen (p. ej. validación PDF/X-1a), tras la
    // tabla y antes de las advertencias: éxito explícito cuando corresponde.
    for (const line of this.state.summaryLines) {
      this.stream.write(`${line}\n`);
    }
    if (this.state.warnings.length > 0) {
      // Cierre explícito con el conteo y el siguiente paso: sin él, el build
      // con advertencias termina sin que el usuario sepa si "terminó bien"
      // (exit 0) y sin conectar con la herramienta de diagnóstico. La guía
      // genérica de validate se omite cuando las advertencias son las
      // autosuficientes de proyecto vacío: ya proponen 'iteraciones init' y
      // validate respondería "sin errores — 0 documentos", un paso que no
      // aporta. Si hay cualquier otra advertencia (frontmatter/config), la
      // guía sigue apareciendo. Constantes compartidas con el emisor (#2074):
      // sin literales replicados que se desincronicen.
      const suggestsValidate = this.state.warnings.some((w) => !w.includes(EMPTY_PROJECT_WARNING_NO_DOCS) && !w.includes(EMPTY_PROJECT_WARNING_INIT));
      this.stream.write(
        `\n${GLYPHS.warning} Build completado con ${plural(this.state.warnings.length, 'advertencia')}${suggestsValidate ? `. Ejecuta 'iteraciones validate' para más detalle.` : '.'}\n`,
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
