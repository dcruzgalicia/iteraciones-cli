import { describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTestVisual, type TestVisualOptions } from '../cli/test-visual.js';
import { exec } from '../lib/run.js';
import {
  blurSigmaFor,
  clearDiffImages,
  compareVisual,
  diffImageName,
  diffTargetFor,
  formatVisualReport,
  formatVisualSummary,
  listPdfFiles,
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

  it('el snapshot espeja dist/files, y un PDF suelto cae al slug del nombre', () => {
    expect(visualSlug('/p/dist/files/99-intervention.pdf')).toBe('99-intervention');
    expect(visualSlug('/p/Mi Documento.PDF')).toBe('mi-documento');
    const output = '/p/dist/files';
    expect(referencePathFor('/p', '/p/dist/files/index.pdf', output)).toBe(join('/p', 'visual', 'index.pdf'));
    // dos index.pdf de carpetas distintas no colisionan
    expect(referencePathFor('/p', '/p/dist/files/anexos/index.pdf', output)).toBe(join('/p', 'visual', 'anexos', 'index.pdf'));
    // fuera del directorio de salida no hay estructura que espejar
    expect(referencePathFor('/p', '/p/suelto.pdf', output)).toBe(join('/p', 'visual', 'suelto.pdf'));
    expect(referencePathFor('/p', '/p/otra/Mi Documento.pdf', output)).toBe(join('/p', 'visual', 'mi-documento.pdf'));
  });

  it('el diff de una página se llama <slug>-page-005-diff.png y vive junto al snapshot', () => {
    expect(diffImageName('index', 5)).toBe('index-page-005-diff.png');
    expect(diffImageName('index', 128)).toBe('index-page-128-diff.png');
    expect(diffTargetFor(join('/p', 'visual', 'anexos', 'index.pdf'))).toEqual({ dir: join('/p', 'visual', 'anexos'), stem: 'index' });
  });

  it('listPdfFiles recorre el árbol en orden y solo se queda con los PDF', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, 'sub'), { recursive: true });
      writeFileSync(join(dir, 'b.pdf'), 'x', 'utf8');
      writeFileSync(join(dir, 'sub', 'a.pdf'), 'x', 'utf8');
      writeFileSync(join(dir, 'nota.txt'), 'x', 'utf8');

      expect(await listPdfFiles(dir)).toEqual([join(dir, 'b.pdf'), join(dir, 'sub', 'a.pdf')]);
      expect(await listPdfFiles(join(dir, 'no-existe'))).toEqual([]);
    });
  });

  it('clearDiffImages borra los diffs de un snapshot sin tocar el resto', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(dir, { recursive: true });
      for (const name of ['index-page-005-diff.png', 'index-page-012-diff.png', 'otro-page-001-diff.png', 'index.pdf']) {
        writeFileSync(join(dir, name), 'x', 'utf8');
      }

      await clearDiffImages(dir, 'index');
      expect(readdirSync(dir).sort()).toEqual(['index.pdf', 'otro-page-001-diff.png']);

      await clearDiffImages(dir);
      expect(readdirSync(dir)).toEqual(['index.pdf']);
    });
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

  it('formatVisualSummary acorta las rutas de los diffs para el resumen de varios PDFs', () => {
    const summary = formatVisualSummary(
      {
        compared: 12,
        unchanged: 11,
        changed: 1,
        details: [{ page: 5, diffPercent: 0.0486, diffImage: '/p/visual/index-page-005-diff.png' }],
        referencePages: 12,
        generatedPages: 12,
        pass: false,
      },
      (path) => path.replace('/p/', ''),
    );
    expect(summary).toEqual(['páginas 12 · sin cambios 11 · modificadas 1', '  pág 5  0.0486 %  visual/index-page-005-diff.png']);
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

  itTool('cambio real de contenido: FAIL con el % de la página y su imagen de diferencia', async () => {
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
      // Solo el diff: ni los renders de las dos páginas (están en los PDFs) ni
      // los intermedios del blur.
      expect(existsSync(join(workDir, 'documento-page-001-diff.png'))).toBe(true);
      expect(existsSync(join(workDir, 'documento-page-001-ref.png'))).toBe(false);
      expect(existsSync(join(workDir, 'documento-page-001-gen.png'))).toBe(false);
      expect(existsSync(join(workDir, 'ref-1.png'))).toBe(false);
      expect(existsSync(join(workDir, 'blur-documento-page-001-diff-a.png'))).toBe(false);
    });
  });

  itTool('los diffs van a diffDir con el nombre del snapshot y el workDir no queda', async () => {
    await withTempDir(async (dir) => {
      const visual = join(dir, 'visual', 'anexos');
      mkdirSync(visual, { recursive: true });
      const reference = writePdf(visual, 'index.pdf', [textPage()]);
      const generated = writePdf(dir, 'gen.pdf', [textPage(0, 5)]);
      const workDir = join(dir, 'work');

      const result = await compareVisual({
        ...resolveVisualOptions(),
        reference,
        generated,
        workDir,
        diffDir: visual,
        diffStem: 'index',
      });

      expect(result.pass).toBe(false);
      expect(result.details[0]?.diffImage).toBe(join(visual, 'index-page-001-diff.png'));
      expect(existsSync(join(visual, 'index-page-001-diff.png'))).toBe(true);
      expect(existsSync(workDir)).toBe(false);
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
async function runCaptured(cwd: string, pdfs: string | string[], options: TestVisualOptions = {}) {
  const out = spyOn(process.stdout, 'write');
  const err = spyOn(process.stderr, 'write');
  const previousExit = process.exitCode;
  process.exitCode = 0;
  try {
    await runTestVisual(cwd, typeof pdfs === 'string' ? [pdfs] : pdfs, options);
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
  it('--update guarda el PDF como snapshot en visual/<slug>.pdf', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'mi-doc.pdf'), 'contenido', 'utf8');

      const { exitCode, stdout } = await runCaptured(dir, 'mi-doc.pdf', { update: true });

      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, 'visual', 'mi-doc.pdf'))).toBe(true);
      expect(stdout).toContain('mi-doc.pdf → visual/mi-doc.pdf');
    });
  });

  it('sin snapshot, explica cómo crearlo y sale con exit 1', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'mi-doc.pdf'), 'contenido', 'utf8');

      const { exitCode, stderr } = await runCaptured(dir, 'mi-doc.pdf', {});

      expect(exitCode).toBe(1);
      expect(stderr).toContain('no hay snapshot en visual/mi-doc.pdf');
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

  it('el modo lote guarda snapshots de todos los PDFs de dist/files, espejando carpetas', async () => {
    await withTempDir(async (dir) => {
      const output = join(dir, 'dist', 'files');
      mkdirSync(join(output, 'anexos'), { recursive: true });
      writeFileSync(join(output, 'index.pdf'), 'uno', 'utf8');
      writeFileSync(join(output, 'anexos', 'index.pdf'), 'dos', 'utf8');
      writeFileSync(join(output, 'leeme.txt'), 'no soy un PDF', 'utf8');

      const { exitCode, stdout } = await runCaptured(dir, [], { update: true });

      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, 'visual', 'index.pdf'))).toBe(true);
      expect(existsSync(join(dir, 'visual', 'anexos', 'index.pdf'))).toBe(true);
      expect(existsSync(join(dir, 'visual', 'leeme.pdf'))).toBe(false);
      expect(stdout).toContain('dist/files/index.pdf → visual/index.pdf');
      expect(stdout).toContain('dist/files/anexos/index.pdf → visual/anexos/index.pdf');
    });
  });

  it('el modo lote sin snapshots pide --update y no compara nada', async () => {
    await withTempDir(async (dir) => {
      const output = join(dir, 'dist', 'files');
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, 'index.pdf'), 'uno', 'utf8');

      const { exitCode, stderr } = await runCaptured(dir, [], {});

      expect(exitCode).toBe(1);
      expect(stderr).toContain('no hay snapshots en visual');
      expect(stderr).toContain('--update');
    });
  });

  it('con snapshots incompletas corta antes de comparar y lista los que faltan', async () => {
    await withTempDir(async (dir) => {
      const output = join(dir, 'dist', 'files');
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, 'index.pdf'), 'uno', 'utf8');
      writeFileSync(join(output, 'libro.pdf'), 'dos', 'utf8');
      mkdirSync(join(dir, 'visual'), { recursive: true });
      writeFileSync(join(dir, 'visual', 'index.pdf'), 'uno', 'utf8');

      const { exitCode, stderr } = await runCaptured(dir, [], {});

      expect(exitCode).toBe(1);
      expect(stderr).toContain('snapshots incompletas');
      expect(stderr).toContain('visual/libro.pdf');
      // nada se comparó: no aparece ningún diff
      expect(readdirSync(join(dir, 'visual'))).toEqual(['index.pdf']);
    });
  });

  it('--update retira los snapshots de PDFs que ya no existen y sus diffs', async () => {
    await withTempDir(async (dir) => {
      const output = join(dir, 'dist', 'files');
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, 'index.pdf'), 'uno', 'utf8');
      mkdirSync(join(dir, 'visual'), { recursive: true });
      writeFileSync(join(dir, 'visual', 'borrado.pdf'), 'viejo', 'utf8');
      writeFileSync(join(dir, 'visual', 'borrado-page-003-diff.png'), 'x', 'utf8');
      writeFileSync(join(dir, 'visual', 'index-page-001-diff.png'), 'x', 'utf8');

      const { exitCode, stdout } = await runCaptured(dir, [], { update: true });

      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, 'visual', 'borrado.pdf'))).toBe(false);
      expect(stdout).toContain('snapshots sin PDF en dist/files: visual/borrado.pdf');
      expect(existsSync(join(dir, 'visual', 'index-page-001-diff.png'))).toBe(false);
      expect(existsSync(join(dir, 'visual', 'index.pdf'))).toBe(true);
    });
  });

  it('sin PDFs en dist/files el modo lote lo dice', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, stderr } = await runCaptured(dir, [], {});
      expect(exitCode).toBe(1);
      expect(stderr).toContain('no hay PDFs en dist/files');
    });
  });

  it('--reference exige un PDF explícito: en el modo lote no tiene sentido', async () => {
    await withTempDir(async (dir) => {
      const { exitCode, stderr } = await runCaptured(dir, [], { reference: 'viejo.pdf' });
      expect(exitCode).toBe(1);
      expect(stderr).toContain('--reference necesita un PDF explícito');
    });
  });
});

describe.skipIf(!toolsOk)('test visual: exit codes reales (#2479)', () => {
  itTool('PASS → exit 0; con cambio de contenido → exit 1 y el resumen con diff', async () => {
    await withTempDir(async (dir) => {
      // proyecto: para que los renders y la caché queden dentro del temp
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
      expect(failRun.stdout).toContain('visual/doc-page-001-diff.png');
      // el veredicto manda a los diffs, no a los PDFs
      expect(failRun.stderr).toContain('1 imagen de diferencia:');
      expect(failRun.stderr).toContain('  visual/doc-page-001-diff.png');

      // y al volver al contenido de la referencia vuelve a pasar
      writeFileSync(generated, makePdf([textPage()]), 'utf8');
      const again = await runCaptured(dir, 'doc.pdf', {});
      expect(again.exitCode).toBe(0);
      expect(again.stdout).toContain('modificadas 0');
    });
  });
});

describe.skipIf(!toolsOk)('test visual: lote real (#2479)', () => {
  itTool('build → --update → cambio → compara todo y deja los diffs en visual/', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'iteraciones.config.yaml'), 'language: es-MX\n', 'utf8');
      const output = join(dir, 'dist', 'files');
      mkdirSync(join(output, 'anexos'), { recursive: true });
      const generated = writePdf(output, 'index.pdf', [textPage()]);
      writePdf(join(output, 'anexos'), 'index.pdf', [textPage()]);

      const update = await runCaptured(dir, [], { update: true });
      expect(update.exitCode).toBe(0);
      expect(existsSync(join(dir, 'visual', 'index.pdf'))).toBe(true);
      expect(existsSync(join(dir, 'visual', 'anexos', 'index.pdf'))).toBe(true);

      // un snapshot huérfano solo avisa: no es una regresión del build
      writeFileSync(join(dir, 'visual', 'huerfano.pdf'), 'sobra', 'utf8');
      const pass = await runCaptured(dir, [], {});
      expect(pass.exitCode).toBe(0);
      expect(pass.stdout).toContain('sin diferencias visuales en 2 PDFs');
      expect(pass.stderr).toContain('snapshots sin PDF en dist/files: visual/huerfano.pdf');

      // cambia un solo PDF: solo sale su diff y solo el suyo se queda en visual/
      writeFileSync(generated, makePdf([textPage(0, 5)]), 'utf8');
      const fail = await runCaptured(dir, [], {});
      expect(fail.exitCode).toBe(1);
      expect(fail.stdout).toContain('visual/index-page-001-diff.png');
      expect(fail.stderr).toContain('1 de 2 PDFs con regresión visual · 1 imagen de diferencia:');
      expect(fail.stderr).toContain('  visual/index-page-001-diff.png');
      expect(existsSync(join(dir, 'visual', 'index-page-001-diff.png'))).toBe(true);
      expect(existsSync(join(dir, 'visual', 'anexos', 'index-page-001-diff.png'))).toBe(false);

      // vuelve al contenido original: PASS y el diff viejo se retira
      writeFileSync(generated, makePdf([textPage()]), 'utf8');
      const again = await runCaptured(dir, [], {});
      expect(again.exitCode).toBe(0);
      expect(existsSync(join(dir, 'visual', 'index-page-001-diff.png'))).toBe(false);
    });
  });
});
