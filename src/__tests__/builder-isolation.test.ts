import { describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    expect(entries.includes('types.ts')).toBe(true);
  });
});

describe('constantes de dominio (#2018)', () => {
  it('state-hash no importa de ningún compositor', async () => {
    const src = await Bun.file('src/builder/state-hash.ts').text();
    for (const line of src.split('\n')) {
      if (line.trim().startsWith('import ')) {
        expect(line.includes('-composer'), `import prohibido en state-hash: ${line}`).toBe(false);
      }
    }
    // La constante vive en el módulo de dominio de pandoc
    expect(await Bun.file('src/lib/pandoc-runner.ts').text()).toContain('export const MD_READER');
    expect(await Bun.file('src/builder/html-composer.ts').text()).not.toContain('export const MD_READER');
  });

  it('computeFiltersHash es determinista: mismo input ⇒ mismo hash (reubicación de MD_READER no cambia valores)', async () => {
    const { computeFiltersHash } = await import('../builder/state-hash.js');
    const { DEFAULT_SITE_CONFIG } = await import('../config/site-config.js');
    const dir = await mkdtemp(join(tmpdir(), 'iteraciones-hash-'));
    try {
      const a = await computeFiltersHash(dir, DEFAULT_SITE_CONFIG);
      const b = await computeFiltersHash(dir, DEFAULT_SITE_CONFIG);
      expect(a.hash).toBe(b.hash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('config sin mutación (#2022)', () => {
  it('el orquestador no asigna disabledPreambleFilters sobre la config del usuario', async () => {
    const src = await Bun.file('src/builder/orchestrator.ts').text();
    // La lista efectiva viaja como parámetro explícito (pipeline/pdfx/hash);
    // una asignación in-place sobre siteConfig reintroduciría el efecto
    // secundario oculto que este issue elimina.
    expect(src).not.toMatch(/siteConfig\.format(\?)?\.pdf(\?)?\.disabledPreambleFilters\s*=/);
  });
});

describe('invalidación por entorno (#2024)', () => {
  it('computeFiltersHash cambia con la versión de pandoc y es estable sin ella', async () => {
    const { computeFiltersHash } = await import('../builder/state-hash.js');
    const { DEFAULT_SITE_CONFIG } = await import('../config/site-config.js');
    const dir = await mkdtemp(join(tmpdir(), 'iteraciones-pandoc-'));
    try {
      const base = await computeFiltersHash(dir, DEFAULT_SITE_CONFIG);
      const again = await computeFiltersHash(dir, DEFAULT_SITE_CONFIG);
      expect(base.hash).toBe(again.hash);
      const v3 = await computeFiltersHash(dir, DEFAULT_SITE_CONFIG, undefined, undefined, 'pandoc 3.1.9');
      const v4 = await computeFiltersHash(dir, DEFAULT_SITE_CONFIG, undefined, undefined, 'pandoc 3.2.0');
      expect(v3.hash).not.toBe(base.hash);
      expect(v4.hash).not.toBe(v3.hash);
      // La caché de archivos no se contamina entre llamadas: misma entrada
      expect(Object.keys(base.cache).length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('computeBibHash incluye el CSL empaquetado solo cuando no hay csl configurado', async () => {
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { computeBibHash, resolveBibOptions } = await import('../builder/state-bib.js');
    const { DEFAULT_SITE_CONFIG } = await import('../config/site-config.js');
    const dir = await mkdtemp(join(tmpdir(), 'iteraciones-csl-'));
    try {
      await writeFile(join(dir, 'refs.bib'), '@book{a, title={T}, author={A}, year={2020}}\n', 'utf8');
      await writeFile(join(dir, 'custom.csl'), '<style/>\n', 'utf8');
      const base = { ...DEFAULT_SITE_CONFIG, bibliography: 'refs.bib' } as unknown as typeof DEFAULT_SITE_CONFIG;
      // Sin csl configurado participa el empaquetado
      const withoutCsl = await computeBibHash(await resolveBibOptions(dir, base));
      const withoutCslAgain = await computeBibHash(await resolveBibOptions(dir, base));
      expect(withoutCsl.hash).toBe(withoutCslAgain.hash);
      // Con csl configurado el empaquetado deja de participar ⇒ hash distinto
      const withCsl = await computeBibHash(await resolveBibOptions(dir, { ...base, csl: 'custom.csl' }));
      expect(withCsl.hash).not.toBe(withoutCsl.hash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('escritura única de state.json (#2025)', () => {
  it('solo persistCompletedState escribe estado: cero escritores a mitad de build', async () => {
    // La propiedad "una sola escritura" es arquitectónica: discovery ya no
    // persiste, y el orquestador no marca completado fuera del cierre común.
    const orchSrc = await Bun.file('src/builder/orchestrator.ts').text();
    expect(orchSrc).not.toMatch(/markStateCompleted|updateCssHash|saveStateFile/);
    const discSrc = await Bun.file('src/builder/discover.ts').text();
    expect(discSrc).not.toMatch(/saveStateFile/);
    // El cierre común contiene la única llamada
    expect(orchSrc).toContain('await persistCompletedState(deps.cwd, deps.pendingState)');
    expect((orchSrc.match(/await persistCompletedState/g) ?? []).length).toBe(1);
  });

  it('round-trip: un build sin cambios después de uno con trabajo no reescribe ni reprocesa', async () => {
    await withTempDir(async (dir) => {
      await initTestProject(dir);
      process.exitCode = 0;
      const { build } = await import('../builder/orchestrator.js');
      await build(dir);
      const mtime1 = (await Bun.file(join(dir, '.iteraciones/state.json')).stat()).mtimeMs;
      await Bun.sleep(5);
      await build(dir);
      const mtime2 = (await Bun.file(join(dir, '.iteraciones/state.json')).stat()).mtimeMs;
      expect(mtime2).toBe(mtime1);
    });
  });
});

describe('drenaje del pool PDF (#2013)', () => {
  it('el catch del pool 1 cancela y espera workers en vuelo antes de propagar', async () => {
    const src = await Bun.file('src/builder/pipeline.ts').text();
    const catchIdx = src.indexOf('pdfConsumer.cancel();');
    expect(catchIdx).toBeGreaterThan(0);
    const after = src.slice(catchIdx, catchIdx + 200);
    expect(after).toContain('await pdfConsumer.quiesce()');
  });
});
