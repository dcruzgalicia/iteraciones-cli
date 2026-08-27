import { describe, expect, it } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from '../builder/orchestrator.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * Regresión #2156: con latex+pdf activos y una imagen de portada procesada,
 * el tex entregado al pool PDF debe vivir en el área de trabajo con rutas
 * ABSOLUTAS. Antes se le pasaba el tex reescrito de dist (nombres namespaced)
 * y latexmk —que corre con cwd/-outdir en el slot— no resolvía los gráficos
 * (pdftex.def "File ... not found").
 *
 * Requiere pandoc + motor LaTeX + ImageMagick; sin ellos, skip informado
 * (decisión D3: los smokes reales son verificación local pre-push).
 */
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('pdf-latex-images.test.ts', SKIP_REASONS.pandoc);

const magickOk = await Bun.spawn(['magick', '-version'], { stdout: 'ignore', stderr: 'ignore' })
  .exited.then((c) => c === 0)
  .catch(() => false);
if (!magickOk) registerSkip('pdf-latex-images.test.ts', SKIP_REASONS.latex);

/** Reporter nulo mínimo: build() exige el contrato aunque no se observe salida. */
function silentReporterForTest() {
  return {
    setFormats: () => {},
    planPhases: () => Promise.resolve(),
    startPhase: () => {},
    reportFile: () => {},
    completePhase: () => {},
    log: () => {},
    addWarning: () => {},
    addSummaryLine: () => {},
    showCleanup: () => {},
    startLightFormats: () => {},
    finish: () => Promise.resolve(),
    fail: () => Promise.resolve(),
  };
}

describe('regresión #2156: el pool PDF compila un tex del work dir con rutas absolutas', () => {
  // Un build real con latexmk tarda ~15-20 s: timeout explícito.
  it.skipIf(!pandocOk || !magickOk)(
    'build completo latex+pdf+endpapers genera el PDF y conserva el bundle portable en dist',
    async () => {
      await withTempDir(async (dir) => {
        await mkdir(dir, { recursive: true });
        // Config mínima con los dos formatos en conflicto.
        const config = ['language: es-MX', 'format:', '  latex:', '    generate: true', '  pdf:', '    generate: true'].join('\n');
        await Bun.write(join(dir, 'iteraciones.config.yaml'), `${config}\n`);
        // PNG real vía ImageMagick (gated arriba): endpapers obliga a
        // preprocesado y distribution non-vacía — la condición exacta del bug.
        await Bun.spawnSync(['magick', '-size', '2x2', 'xc:white', join(dir, 'endpaper.png')]);
        const doc = ['---', 'title: Cuidar-se', 'date: 2026-01-01', 'endpapers: ./endpaper.png', '---', '', '# Capítulo', '', 'Contenido.'].join(
          '\n',
        );
        await Bun.write(join(dir, 'manuscrito.md'), `${doc}\n`);

        await build(dir, { full: true }, silentReporterForTest());

        const dist = join(dir, 'dist', 'files');
        const pdf = Bun.file(join(dist, 'cuidar-se.pdf'));
        expect(await pdf.exists()).toBe(true);
        expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(1000);
        // Bundle portable intacto (ADR #2084): copia namespaced junto al tex de dist.
        expect(await Bun.file(join(dist, 'cuidar-se-endpaper.jpg')).exists()).toBe(true);

        // El tex de compilación del pool vive en el área de trabajo y apunta a
        // la ruta absoluta procesada — NO al nombre namespaced de dist (#2156).
        const workTexPath = join(dir, '.iteraciones', 'tmp', 'pdf', 'cuidar-se.tex');
        const workTex = await Bun.file(workTexPath).text();
        expect(workTex).toContain('processed-images/endpaper.jpg');
        expect(workTex).not.toContain('cuidar-se-endpaper.jpg');
      });
    },
    120_000,
  );
});
