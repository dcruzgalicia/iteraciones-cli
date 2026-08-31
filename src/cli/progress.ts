import { join } from 'node:path';
import { EMPTY_PROJECT_WARNING_CODES } from '../builder/orchestrator.js';
import type { BuildReporter, RenderFileReport } from '../builder/types.js';
import { GLYPHS } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { formatTime, TrackerRenderer } from './progress-render.js';
import { type FormatState, type PipelinePhase, TrackerState } from './progress-state.js';

const LABEL_WIDTH = 30;

export class ProgressTracker implements BuildReporter {
  private t0: number;
  private verbose: boolean;
  private tty: boolean;
  private stream: NodeJS.WriteStream;
  private state: TrackerState;
  private renderer: TrackerRenderer;

  constructor(options: { renderer?: 'default' | 'verbose' | 'test'; stream?: NodeJS.WriteStream; tty?: boolean } = {}) {
    this.verbose = options.renderer === 'verbose';
    this.stream = options.stream ?? process.stdout;
    this.tty = options.tty ?? (options.renderer === 'default' && this.stream.isTTY === true);
    this.state = new TrackerState();
    this.renderer = new TrackerRenderer(this.stream, this.tty);
    this.t0 = performance.now();
    if (options.renderer === 'default') {
      if (this.tty) process.once('exit', () => this.stream.write('\x1b[?25h'));
    }
  }

  addWarning(message: string): void {
    this.state.addWarning(message);
  }

  addSummaryLine(line: string): void {
    this.state.addSummaryLine(line);
  }

  log(msg: string): void {
    if (this.verbose) this.stream.write(`[info] ${msg}\n`);
  }

  planPhases(phases: PipelinePhase[]): void {
    this.state.planPhases(phases);
  }

  startPhase(phase: PipelinePhase, total: number = 0): void {
    const created = this.state.startPhase(phase, total);
    if (created) this.renderer.renderInactiveFormats(this.state);
    this.renderer.renderRow(this.state, this.state.rowKeyFor(phase));
  }

  reportFile(file: RenderFileReport): void {
    const row = this.state.getRow(this.state.rowKeyFor(file.phase));
    if (row?.status !== 'active') return;
    if (!this.state.reportFile(file.phase)) return;
    const total = this.state.phaseCount(file.phase);
    const live = this.state.phaseLive(file.phase);
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

  getWarnings(): string[] {
    return this.state.warnings;
  }

  async fail(): Promise<void> {
    for (const w of this.state.warnings) {
      process.stderr.write(`${w}
`);
    }
    for (const key of this.state.failActiveRows()) {
      this.renderer.renderRow(this.state, key);
    }
    if (this.state.skipPendingRenderRow()) this.renderer.renderRow(this.state, 'phase:render');
    const created = this.state.createFormatsBlock();
    if (created) this.renderer.renderInactiveFormats(this.state);
  }

  showCleanup(): void {
    if (this.verbose) this.stream.write('[info] Archivos temporales limpiados\n');
  }

  setFormats(formats: FormatState[]): void {
    this.state.setFormats(formats);
  }

  startLightFormats(): void {
    this.state.startLightFormats(performance.now());
  }

  static compactInvalidations(list: string[], max = 3, budget = 72): string {
    const parts: string[] = [];
    let used = 0;
    let included = 0;
    for (const reason of list) {
      const add = (included > 0 ? 2 : 0) + reason.length;
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
    if (this.state.warnings.length === 0) {
      this.stream.write(`\n${GLYPHS.success} Todo listo.\n\n`);
    } else {
      this.stream.write(`\n`);
    }

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
    const formatDetail = processed > 0 && formats ? formats.map((f) => `${f} ${this.state.phaseCount(f as PipelinePhase)}`).join(', ') : '';
    this.stream.write(`  ${padRight('Formatos activos', LABEL_WIDTH)}${formatCount}${formatDetail ? ` — ${formatDetail}` : ''}\n`);
    if (outputDir) {
      this.stream.write(`  ${padRight('Salida', LABEL_WIDTH)}${outputDir}\n`);
    }
    this.stream.write(`  ${padRight('Tiempo total', LABEL_WIDTH)}${formatTime(totalTime)}\n`);
    if (outputDir && processed > 0) {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      const indexHtml = join(outputDir, 'index.html');
      const target = (await Bun.file(indexHtml).exists()) ? indexHtml : outputDir;
      const command = `${opener} "${target}"`;
      this.stream.write(`  ${padRight('Abre el resultado', LABEL_WIDTH)}${command}\n`);
    }
    for (const line of this.state.summaryLines) {
      this.stream.write(`${line}\n`);
    }
    if (this.state.warnings.length > 0) {
      const suggestsValidate = this.state.warnings.some((w) => !w.includes(EMPTY_PROJECT_WARNING_CODES.noDocs));
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
