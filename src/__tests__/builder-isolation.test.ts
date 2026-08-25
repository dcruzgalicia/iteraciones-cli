import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { initTestProject, withTempDir } from './helpers.js';

describe('aislamiento builder↔cli (#2017)', () => {
  it('ningún archivo de src/builder importa de src/cli', async () => {
    const files = await Array.fromAsync(new Bun.Glob('**/*.ts').scan({ cwd: 'src/builder' }));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const src = await Bun.file(join('src/builder', file)).text();
      expect(src.includes("'../cli/"), `${file} importa de ../cli/`).toBe(false);
    }
  });

  it('build() acepta un reporter propio y opera headless sin tracker', async () => {
    const eventos: string[] = [];
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      // build() por defecto usa silentReporter: sin inyección no escribe nada
      process.exitCode = 0;
      await import('../builder/orchestrator.js').then((m) => m.build(dir));
      expect(process.exitCode).toBe(0);
      expect(await Bun.file(join(dir, 'dist', 'files', 'test-document.html')).exists()).toBe(true);

      // Con un reporter contable: el builder emite el ciclo completo
      // (--full evita el camino "sin trabajo", que no planifica fases)
      const { build } = await import('../builder/orchestrator.js');
      await build(
        dir,
        { full: true },
        {
          setFormats(formats) {
            eventos.push(`formats:${formats.length}`);
          },
          planPhases(phases) {
            eventos.push(`plan:${phases.join(',')}`);
            return Promise.resolve();
          },
          startPhase(phase) {
            eventos.push(`start:${phase}`);
          },
          reportFile(file) {
            eventos.push(`file:${file.relativePath}`);
          },
          completePhase(count) {
            eventos.push(`done:${count ?? '?'}`);
          },
          log(message) {
            eventos.push(`log:${message}`);
          },
          addWarning(message) {
            eventos.push(`warn:${message}`);
          },
          addSummaryLine(line) {
            eventos.push(`summary:${line}`);
          },
          showCleanup() {},
          startLightFormats() {
            eventos.push('light');
          },
          finish(processed) {
            eventos.push(`finish:${processed}`);
            return Promise.resolve();
          },
          fail() {
            return Promise.resolve();
          },
        },
      );
      expect(eventos.some((e) => e.startsWith('formats:'))).toBe(true);
      expect(eventos.some((e) => e.startsWith('plan:discovery'))).toBe(true);
      expect(eventos.some((e) => e.startsWith('finish:'))).toBe(true);
    });
  });

  it('sanity: readdir de builder disponible para futuras aserciones', async () => {
    const entries = await readdir('src/builder');
    expect(entries.includes('reporter.ts')).toBe(true);
    expect(entries.includes('types.ts')).toBe(true);
  });
});
