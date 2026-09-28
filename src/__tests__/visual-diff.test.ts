import { describe, expect, it, spyOn } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTestVisual, type TestVisualOptions } from '../cli/test-visual.js';
import { exec } from '../lib/run.js';
import {
  blurSigmaFor,
  compareVisual,
  formatVisualReport,
  pngSize,
  referencePathFor,
  resolveVisualOptions,
  resolveVisualWorkspaces,
  sortPageFiles,
  visualSlug,
} from '../lib/visual-diff.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2479 — regresión visual de PDFs: `iteraciones test visual`.
 *
 * La lógica pura (orden de páginas, dimensiones del PNG, flags, resumen) se
 * verifica sin herramientas. La comparación de verdad necesita pdftoppm
 * (poppler) + ImageMagick y usa PDFs mínimos hechos a mano —rectángulos, sin
 * fuentes— para que cualquier poppler los renderice. Sin ellas, skip informado
 * (decisión D3).
 */
async function toolAvailable(command: string, args: string[]): Promise<boolean> {
  try {
    return (await exec(command, args)).exitCode === 0;
  } catch {
    return false;
  }
}

const pdftoppmOk = await toolAvailable('pdftoppm', ['-v']);
if (!pdftoppmOk) registerSkip('visual-diff.test.ts', SKIP_REASONS.pdftoppm);

const magickOk = await toolAvailable('magick', ['-version']);
if (!magickOk) registerSkip('visual-diff.test.ts', SKIP_REASONS.magick);

const toolsOk = pdftoppmOk && magickOk;

/**
 * `it` con margen: cada comparación real son 4 renders + 12 lanzamientos de
 * `magick` (~2,5 s), así que un test con tres corridas se pasa de los 5 s por
 * defecto de `bun test`. 30 s dejan holgura incluso con la máquina cargada.
 */
const itTool = (name: string, fn: () => Promise<void>): void => {
  it(name, fn, { timeout: 30_000 });
};

type Rect = [number, number, number, number];

/**
 * PDF de una o varias páginas escrito a mano: solo rectángulos negros sobre
 * blanco, sin fuentes ni recursos, con xref calculado. Vale como referencia y
 * como variante cambiada para probar el comparador.
 */
function makePdf(pages: Rect[][]): string {
  const firstContentId = 3 + pages.length;
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((_, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents ${firstContentId + i} 0 R >>`);
  });
  pages.forEach((rects) => {
    const stream = rects.map(([x, y, w, h]) => `0 0 0 rg ${x} ${y} ${w} ${h} re f`).join('\n');
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  const chunks: string[] = [];
  const offsets: number[] = [];
  let offset = 0;
  const push = (text: string): void => {
    chunks.push(text);
    offset += text.length;
  };
  push('%PDF-1.4\n');
  objects.forEach((body, i) => {
    offsets[i + 1] = offset;
    push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefOffset = offset;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objects.length; id++) push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return chunks.join('');
}

/** 30 líneas de "texto" (rects de 400×7 pt); `yShift` las desplaza y `wideLine` engrosa una. */
function textPage(yShift = 0, wideLine = -1): Rect[] {
  return Array.from({ length: 30 }, (_, i): Rect => [72, 640 - i * 14 + yShift, i === wideLine ? 560 : 400, 7]);
}

function writePdf(dir: string, name: string, pages: Rect[][]): string {
  const path = join(dir, name);
  writeFileSync(path, makePdf(pages), 'utf8');
  return path;
}

describe('visual-diff: lógica pura (#2479)', () => {
  it('pngSize lee el IHDR y devuelve null para lo que no es PNG', () => {
    const ihdr = new Uint8Array(24);
    ihdr.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(ihdr.buffer);
    view.setUint32(16, 2480, false);
    view.setUint32(20, 3508, false);
    expect(pngSize(ihdr)).toEqual({ width: 2480, height: 3508 });
    expect(pngSize(new Uint8Array(10))).toBeNull();
    expect(pngSize(new Uint8Array(64))).toBeNull();
  });

  it('los PNG de pdftoppm se ordenan por número de página, no alfabéticamente', () => {
    expect(sortPageFiles(['p-10.png', 'p-2.png', 'p-1.png'])).toEqual(['p-1.png', 'p-2.png', 'p-10.png']);
    expect(sortPageFiles(['p-100.png', 'p-002.png', 'p-001.png'])).toEqual(['p-001.png', 'p-002.png', 'p-100.png']);
  });

  it('el slug sale del nombre del PDF y la referencia vive en visual/<slug>.pdf', () => {
    expect(visualSlug('/p/dist/files/99-intervention.pdf')).toBe('99-intervention');
    expect(visualSlug('/p/Mi Documento.PDF')).toBe('mi-documento');
    expect(referencePathFor('/p', '99-intervention')).toBe(join('/p', 'visual', '99-intervention.pdf'));
  });

  it('el blur mide lo mismo en superficie física: dpi/150 px', () => {
    expect(blurSigmaFor(150)).toBe(1);
    expect(blurSigmaFor(300)).toBe(2);
    expect(blurSigmaFor(600)).toBe(4);
  });

  it('el directorio de trabajo vive en el proyecto cuando lo hay, y en el temporal cuando no', async () => {
    await withTempDir(async (dir) => {
      const solo = await resolveVisualWorkspaces(dir, 'doc');
      expect(solo.workDir).toBe(join(tmpdir(), 'iteraciones-visual', 'doc'));

      writeFileSync(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\n', 'utf8');
      const proyecto = await resolveVisualWorkspaces(dir, 'doc');
      expect(proyecto.workDir).toBe(join(dir, '.iteraciones', 'tmp', 'visual', 'doc'));
      expect(proyecto.cachePath).toBe(join(dir, '.iteraciones', 'tmp', 'visual', 'cache.json'));
    });
  });

  it('resolveVisualOptions aplica los defaults y rechaza flags inválidos', () => {
    expect(resolveVisualOptions()).toEqual({ dpi: 300, thresholdPercent: 0.005, fuzzPercent: 15 });
    expect(resolveVisualOptions({ dpi: '150', threshold: '0.1', fuzz: '5' })).toEqual({
      dpi: 150,
      thresholdPercent: 0.1,
      fuzzPercent: 5,
    });
    expect(() => resolveVisualOptions({ dpi: '0' })).toThrow('--dpi inválido');
    expect(() => resolveVisualOptions({ dpi: '300.5' })).toThrow('--dpi inválido');
    expect(() => resolveVisualOptions({ dpi: 'rapido' })).toThrow('--dpi inválido');
    expect(() => resolveVisualOptions({ threshold: '-1' })).toThrow('--threshold inválido');
    expect(() => resolveVisualOptions({ fuzz: '101' })).toThrow('--fuzz inválido');
  });

  it('formatVisualReport trae páginas, sin cambios, modificadas, % por página y ruta del diff', () => {
    const text = formatVisualReport({
      result: {
        compared: 88,
        unchanged: 85,
        changed: 3,
        details: [
          { page: 3, diffPercent: 0.4213, diffImage: '/tmp/v/doc/page-003-diff.png' },
          { page: 17, diffPercent: 1.9001, diffImage: '/tmp/v/doc/page-017-diff.png' },
        ],
        referencePages: 88,
        generatedPages: 88,
        pass: false,
        diffDir: '/tmp/v/doc',
      },
      options: { dpi: 300, thresholdPercent: 0.005, fuzzPercent: 15 },
      referenceLabel: 'visual/index.pdf',
      generatedLabel: 'dist/files/index.pdf',
    });
    expect(text).toContain('dist/files/index.pdf vs visual/index.pdf · 300 dpi · umbral 0.005 % · fuzz 15 %');
    expect(text).toContain('páginas 88 · sin cambios 85 · modificadas 3');
    expect(text).toContain('0.4213 %');
    expect(text).toContain('page-003-diff.png');
    expect(text).toContain('page-017-diff.png');

    const paginasDistintas = formatVisualReport({
      result: { compared: 1, unchanged: 1, changed: 0, details: [], referencePages: 2, generatedPages: 1, pass: false },
      options: { dpi: 300, thresholdPercent: 0.005, fuzzPercent: 15 },
      referenceLabel: 'visual/doc.pdf',
      generatedLabel: 'doc.pdf',
    });
    expect(paginasDistintas).toContain('páginas distintas: referencia 2 · generado 1');
  });
});

describe.skipIf(!toolsOk)('visual-diff: comparación real (#2479)', () => {
  itTool('PDFs idénticos: PASS sin ningún artefacto', async () => {
    await withTempDir(async (dir) => {
      const reference = writePdf(dir, 'a.pdf', [textPage()]);
      const generated = writePdf(dir, 'b.pdf', [textPage()]);
      const workDir = join(dir, 'work');

      const result = await compareVisual({ ...resolveVisualOptions(), reference, generated, workDir });

      expect(result.pass).toBe(true);
      expect(result.compared).toBe(1);
      expect(result.unchanged).toBe(1);
      expect(result.changed).toBe(0);
      expect(result.details).toEqual([]);
      expect(result.diffDir).toBeUndefined();
      expect(existsSync(workDir)).toBe(false);
    });
  });

  itTool('cambio real de contenido: FAIL con el % de la página y sus tres imágenes', async () => {
    await withTempDir(async (dir) => {
      const reference = writePdf(dir, 'a.pdf', [textPage()]);
      const generated = writePdf(dir, 'b.pdf', [textPage(0, 5)]);
      const workDir = join(dir, 'work');

      const result = await compareVisual({ ...resolveVisualOptions(), reference, generated, workDir });

      expect(result.pass).toBe(false);
      expect(result.changed).toBe(1);
      expect(result.details[0]?.page).toBe(1);
      expect(result.details[0]?.diffPercent ?? 0).toBeGreaterThan(0.005);
      expect(result.diffDir).toBe(workDir);
      for (const artifact of ['page-001-ref.png', 'page-001-gen.png', 'page-001-diff.png']) {
        expect(existsSync(join(workDir, artifact))).toBe(true);
      }
      expect(existsSync(join(workDir, 'ref-1.png'))).toBe(false);
      expect(existsSync(join(workDir, 'blur-page-001-diff-a.png'))).toBe(false);
    });
  });

  itTool('desplazamiento subpíxel (0.1 pt): invisible y por debajo del umbral', async () => {
    await withTempDir(async (dir) => {
      const reference = writePdf(dir, 'a.pdf', [textPage()]);
      const generated = writePdf(dir, 'b.pdf', [textPage(0.1)]);
      const workDir = join(dir, 'work');

      const result = await compareVisual({ ...resolveVisualOptions(), reference, generated, workDir });

      expect(result.pass).toBe(true);
      expect(result.changed).toBe(0);
      expect(result.details[0]).toBeUndefined();
    });
  });

  itTool('número de páginas distinto: FAIL con el motivo y sin artefactos', async () => {
    await withTempDir(async (dir) => {
      const reference = writePdf(dir, 'a.pdf', [textPage(), textPage()]);
      const generated = writePdf(dir, 'b.pdf', [textPage()]);
      const workDir = join(dir, 'work');

      const result = await compareVisual({ ...resolveVisualOptions(), reference, generated, workDir });

      expect(result.pass).toBe(false);
      expect(result.referencePages).toBe(2);
      expect(result.generatedPages).toBe(1);
      expect(result.compared).toBe(1);
      expect(result.changed).toBe(0);
      expect(result.diffDir).toBeUndefined();
      expect(existsSync(workDir)).toBe(false);
    });
  });

  itTool('la caché de PASS evita volver a renderizar', async () => {
    await withTempDir(async (dir) => {
      const reference = writePdf(dir, 'a.pdf', [textPage()]);
      const generated = writePdf(dir, 'b.pdf', [textPage()]);
      const workDir = join(dir, 'work');
      const cachePath = join(dir, 'cache.json');

      const first = await compareVisual({ ...resolveVisualOptions(), reference, generated, workDir, cachePath });
      expect(first.pass).toBe(true);
      expect(first.fromCache).toBeUndefined();
      expect(existsSync(cachePath)).toBe(true);

      const second = await compareVisual({ ...resolveVisualOptions(), reference, generated, workDir, cachePath });
      expect(second.pass).toBe(true);
      expect(second.fromCache).toBe(true);
      expect(second.compared).toBe(1);

      // otro dpi es otra corrida: no reutiliza la caché
      const otherDpi = await compareVisual({ ...resolveVisualOptions({ dpi: '150' }), reference, generated, workDir, cachePath });
      expect(otherDpi.fromCache).toBeUndefined();
      expect(otherDpi.pass).toBe(true);
    });
  });

  itTool('con un PDF corrupto, pdftoppm termina con error explicado', async () => {
    await withTempDir(async (dir) => {
      const reference = join(dir, 'a.pdf');
      writeFileSync(reference, 'esto no es un PDF', 'utf8');
      const generated = writePdf(dir, 'b.pdf', [textPage()]);

      await expect(compareVisual({ ...resolveVisualOptions(), reference, generated, workDir: join(dir, 'work') })).rejects.toThrow(
        'pdftoppm no pudo renderizar',
      );
    });
  });
});

/** Corre `runTestVisual` capturando la salida y el exit code, sin dejar rastro. */
async function runCaptured(cwd: string, pdf: string, options: TestVisualOptions = {}) {
  const out = spyOn(process.stdout, 'write');
  const err = spyOn(process.stderr, 'write');
  const previousExit = process.exitCode;
  process.exitCode = 0;
  try {
    await runTestVisual(cwd, pdf, options);
    return {
      exitCode: process.exitCode ?? 0,
      stdout: out.mock.calls.map((args) => args.map(String).join('')).join(''),
      stderr: err.mock.calls.map((args) => args.map(String).join('')).join(''),
    };
  } finally {
    out.mockRestore();
    err.mockRestore();
    process.exitCode = previousExit;
  }
}

describe('test visual: CLI (#2479)', () => {
  it('--update guarda el PDF como referencia en visual/<slug>.pdf', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'mi-doc.pdf'), 'contenido', 'utf8');

      const { exitCode, stdout } = await runCaptured(dir, 'mi-doc.pdf', { update: true });

      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, 'visual', 'mi-doc.pdf'))).toBe(true);
      expect(stdout).toContain('mi-doc.pdf → visual/mi-doc.pdf');
    });
  });

  it('sin referencia, explica cómo crearla y sale con exit 1', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'mi-doc.pdf'), 'contenido', 'utf8');

      const { exitCode, stderr } = await runCaptured(dir, 'mi-doc.pdf', {});

      expect(exitCode).toBe(1);
      expect(stderr).toContain('no hay referencia en visual/mi-doc.pdf');
      expect(stderr).toContain('--update');
    });
  });

  it('--update y --reference no se pueden combinar', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'mi-doc.pdf'), 'contenido', 'utf8');

      const { exitCode, stderr } = await runCaptured(dir, 'mi-doc.pdf', { update: true, reference: 'otro.pdf' });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('incompatibles');
      expect(existsSync(join(dir, 'visual', 'mi-doc.pdf'))).toBe(false);
    });
  });

  it('un PDF inexistente y flags inválidos terminan en exit 1 con el motivo', async () => {
    await withTempDir(async (dir) => {
      const faltante = await runCaptured(dir, 'nadie.pdf', { update: true });
      expect(faltante.exitCode).toBe(1);
      expect(faltante.stderr).toContain('no existe el PDF');

      writeFileSync(join(dir, 'mi-doc.pdf'), 'contenido', 'utf8');
      const flag = await runCaptured(dir, 'mi-doc.pdf', { update: true, dpi: '0' });
      expect(flag.exitCode).toBe(1);
      expect(flag.stderr).toContain('--dpi inválido');
    });
  });
});

describe.skipIf(!toolsOk)('test visual: exit codes reales (#2479)', () => {
  itTool('PASS → exit 0; con cambio de contenido → exit 1 y el resumen con diff', async () => {
    await withTempDir(async (dir) => {
      // proyecto: para que los artefactos y la caché queden dentro del temp
      writeFileSync(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\n', 'utf8');
      const generated = writePdf(dir, 'doc.pdf', [textPage()]);
      await runCaptured(dir, 'doc.pdf', { update: true });

      const passRun = await runCaptured(dir, 'doc.pdf', {});
      expect(passRun.exitCode).toBe(0);
      expect(passRun.stdout).toContain('páginas 1 · sin cambios 1 · modificadas 0');
      expect(passRun.stdout).toContain('sin diferencias visuales en 1 páginas');

      writeFileSync(generated, makePdf([textPage(0, 5)]), 'utf8');
      const failRun = await runCaptured(dir, 'doc.pdf', {});
      expect(failRun.exitCode).toBe(1);
      expect(failRun.stdout).toContain('páginas 1 · sin cambios 0 · modificadas 1');
      expect(failRun.stdout).toContain('page-001-diff.png');
      expect(failRun.stderr).toContain('diferencias visuales');
      expect(failRun.stderr).toContain('artefactos en');

      // y al volver al contenido de la referencia vuelve a pasar
      writeFileSync(generated, makePdf([textPage()]), 'utf8');
      const again = await runCaptured(dir, 'doc.pdf', {});
      expect(again.exitCode).toBe(0);
      expect(again.stdout).toContain('modificadas 0');
    });
  });
});
