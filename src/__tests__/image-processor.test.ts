import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeProcessTargets,
  processDocumentImages,
  processImage,
  resetMagickCache,
  rewriteImagePaths,
  scanTitlePageFieldImages,
} from '../builder/image-processor.js';

describe('scanTitlePageFieldImages', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'iteraciones-imgtest-'));
    resetMagickCache();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('retorna vacío si no hay campos multilinea', async () => {
    const result = await scanTitlePageFieldImages({}, cwd);
    expect(result).toEqual([]);
  });

  it('retorna vacío si los campos no tienen imágenes', async () => {
    const fm = { lowertitleback: 'Texto simple sin imágenes' };
    const result = await scanTitlePageFieldImages(fm, cwd);
    expect(result).toEqual([]);
  });

  it('encuentra imágenes en lowertitleback (string)', async () => {
    // Crear imagen ficticia
    const imgDir = join(cwd, 'Images');
    mkdirSync(imgDir, { recursive: true });
    writeFileSync(join(imgDir, 'logo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // JPEG header

    const fm = { lowertitleback: '![logo](Images/logo.jpg)' };
    const result = await scanTitlePageFieldImages(fm, cwd);
    expect(result).toHaveLength(1);
    const img = result[0];
    expect(img).toBeDefined();
    expect(img?.absPath).toEndWith('Images/logo.jpg');
    expect(img?.isSvg).toBe(false);
  });

  it('encuentra imágenes en lowertitleback (array multilinea)', async () => {
    const imgDir = join(cwd, 'Images');
    mkdirSync(imgDir, { recursive: true });
    writeFileSync(join(imgDir, 'logo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const fm = { lowertitleback: ['Texto antes', '', '![logo](Images/logo.jpg)'] };
    const result = await scanTitlePageFieldImages(fm, cwd);
    expect(result).toHaveLength(1);
    const img = result[0];
    expect(img).toBeDefined();
    expect(img?.absPath).toEndWith('Images/logo.jpg');
  });

  it('lanza BuildError si la imagen no existe', async () => {
    const fm = { lowertitleback: '![missing](Images/missing.jpg)' };
    await expect(scanTitlePageFieldImages(fm, cwd)).rejects.toThrow('imagen no encontrada en "lowertitleback"');
  });

  it('lanza BuildError si SVG no tiene width', async () => {
    const imgDir = join(cwd, 'Images');
    mkdirSync(imgDir, { recursive: true });
    writeFileSync(join(imgDir, 'logo.svg'), '<svg></svg>');

    const fm = { lowertitleback: '![logo](Images/logo.svg)' };
    await expect(scanTitlePageFieldImages(fm, cwd)).rejects.toThrow('imagen SVG en "lowertitleback" requiere {width=...}');
  });

  it('acepta SVG con width especificado', async () => {
    const imgDir = join(cwd, 'Images');
    mkdirSync(imgDir, { recursive: true });
    writeFileSync(join(imgDir, 'logo.svg'), '<svg></svg>');

    const fm = { lowertitleback: '![logo](Images/logo.svg){width=100pt}' };
    const result = await scanTitlePageFieldImages(fm, cwd);
    expect(result).toHaveLength(1);
    const img = result[0];
    expect(img).toBeDefined();
    expect(img?.isSvg).toBe(true);
    expect(img?.attrs).toBe('{width=100pt}');
  });

  it('escanea múltiples campos', async () => {
    const imgDir = join(cwd, 'Images');
    mkdirSync(imgDir, { recursive: true });
    writeFileSync(join(imgDir, 'logo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    writeFileSync(join(imgDir, 'icon.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const fm = {
      lowertitleback: '![logo](Images/logo.jpg)',
      uppertitleback: '![icon](Images/icon.jpg)',
    };
    const result = await scanTitlePageFieldImages(fm, cwd);
    expect(result).toHaveLength(2);
  });

  it('ignora URLs externas', async () => {
    const fm = { lowertitleback: '![logo](https://example.com/logo.jpg)' };
    const result = await scanTitlePageFieldImages(fm, cwd);
    expect(result).toEqual([]);
  });

  it('ignora rutas absolutas', async () => {
    const fm = { lowertitleback: '![logo](/absolute/path/logo.jpg)' };
    const result = await scanTitlePageFieldImages(fm, cwd);
    expect(result).toEqual([]);
  });

  it('ignora campos no multilinea (subject, publishers)', async () => {
    const imgDir = join(cwd, 'Images');
    mkdirSync(imgDir, { recursive: true });
    writeFileSync(join(imgDir, 'logo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const fm = { subject: '![logo](Images/logo.jpg)' };
    const result = await scanTitlePageFieldImages(fm, cwd);
    expect(result).toEqual([]);
  });
});

describe('correlación magick ausente ↔ PDF/X (#2040)', () => {
  it('sin magick: un único warning por build, con mención PDF/X solo si 99-pdfx activo', async () => {
    resetMagickCache();
    const stderrSpy = spyOn(process.stderr, 'write');
    try {
      const noImages = await processDocumentImages(
        [],
        {},
        '/tmp',
        { w: 100, h: 150, textW: 80 },
        false,
        '/tmp/out',
        undefined,
        true,
        async () => false,
      );
      expect(noImages.imageMap.size).toBe(0);
      // Segundo documento: sin segundo warning (memoizado por proceso)
      await processDocumentImages([], {}, '/tmp', { w: 100, h: 150, textW: 80 }, false, '/tmp/out', undefined, true, async () => false);
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect((output.match(/ImageMagick no disponible/g) ?? []).length).toBe(1);
      expect(output).toContain('pueden fallar la certificación PDF/X');
    } finally {
      stderrSpy.mockRestore();
      resetMagickCache();
    }
  });

  it('con 99-pdfx inactivo el warning omite la mención de certificación', async () => {
    resetMagickCache();
    const stderrSpy = spyOn(process.stderr, 'write');
    try {
      await processDocumentImages([], {}, '/tmp', { w: 100, h: 150, textW: 80 }, false, '/tmp/out', undefined, false, async () => false);
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('ImageMagick no disponible');
      expect(output).not.toContain('certificación PDF/X');
    } finally {
      stderrSpy.mockRestore();
      resetMagickCache();
    }
  });
});

describe('blindaje pipeline magick (#2085, fixes ecba990a/3b7d7a97)', () => {
  it('los argumentos incluyen -colorspace Gray antes del output y -density 300 (sin binario real)', async () => {
    resetMagickCache();
    const realSpawn = Bun.spawn;
    const calls: string[][] = [];
    Bun.spawn = ((args: string[]) => {
      calls.push(args as string[]);
      // Contrato mínimo que exec() consume: stdout/stderr legibles y exit 0
      return {
        exited: Promise.resolve(0),
        stdout: new Response('').body,
        stderr: new Response('').body,
        pid: 12345,
      } as unknown as ReturnType<typeof realSpawn>;
    }) as typeof Bun.spawn;
    try {
      const outDir = mkdtempSync(join(tmpdir(), 'magick-args-'));
      const src = join(outDir, 'orig.png');
      writeFileSync(src, Buffer.from('89504e47', 'hex'));
      const result = await processImage(src, 80, 120, false, outDir);
      expect(result).toEndWith('.jpg');
      expect(calls).toHaveLength(1);
      const args = calls[0];
      if (args === undefined) throw new Error('se esperaba una invocación registrada de magick');
      expect(args[0]).toBe('magick');
      expect(args).toContain('-colorspace');
      expect(args[args.indexOf('-colorspace') + 1]).toBe('Gray'); // 1 canal, no CMYK (fix ecba990a)
      expect(args).not.toContain('CMYK');
      expect(args).toContain('-density');
      expect(args).toContain('-quality');
      rmSync(outDir, { recursive: true, force: true });
    } finally {
      Bun.spawn = realSpawn;
      resetMagickCache();
    }
  });
});

describe('computeProcessTargets (parte pura de processDocumentImages, #2132)', () => {
  const pageDims = { w: 152.4, h: 228.6, textW: 128.6 };

  it('sin crop: caja de texto para target y página completa para endpapers', () => {
    const t = computeProcessTargets(pageDims, false);
    expect(t).toEqual({ targetW: pageDims.textW, targetH: pageDims.h, endpaperW: pageDims.w, endpaperH: pageDims.h });
  });

  it('con crop activo: +6mm de bleed en las cuatro dimensiones', () => {
    const t = computeProcessTargets(pageDims, true);
    expect(t.targetW).toBeCloseTo(pageDims.textW + 6);
    expect(t.targetH).toBeCloseTo(pageDims.h + 6);
    expect(t.endpaperW).toBeCloseTo(pageDims.w + 6);
    expect(t.endpaperH).toBeCloseTo(pageDims.h + 6);
  });

  it('endpapers SIEMPRE usa página completa aunque la caja difiera (#1975)', () => {
    const dimsAsimetricas = { w: 140, h: 216, textW: 110 };
    const conCrop = computeProcessTargets(dimsAsimetricas, true);
    expect(conCrop.endpaperW).toBe(146); // w + bleed
    expect(conCrop.targetW).toBe(116); // textW + bleed
    const sinCrop = computeProcessTargets(dimsAsimetricas, false);
    expect(sinCrop.endpaperW).toBe(140);
    expect(sinCrop.targetW).toBe(110);
  });
});

describe('rewriteImagePaths — reemplazo anclado (#2170)', () => {
  const docDir = '/proyecto/capitulos';
  const processed = '/proyecto/capitulos/.iteraciones/processed-images/img.jpg';
  const map = new Map([['/proyecto/capitulos/img.png', processed]]);

  it('reescribe el objetivo de la imagen markdown pero no colisiones de substring', () => {
    const content = [
      '![portada](img.png)',
      'ver ![otra](./img.png) también',
      'la referencia ![b](img.png.bak) no se toca',
      'el texto suelto "img.png" tampoco',
      '`code con img.png dentro` intacto',
    ].join('\n');
    const result = rewriteImagePaths(content, map, docDir);
    expect(result).toContain(`![portada](${processed})`);
    expect(result).toContain(`![otra](${processed})`);
    expect(result).toContain('![b](img.png.bak)');
    expect(result).toContain('el texto suelto "img.png" tampoco');
    expect(result).toContain('`code con img.png dentro` intacto');
  });

  it('reescribe los campos de portada preservando comillas', () => {
    const content = ['---', 'title-image: "img.png"', "publishers-image: 'img.png'", 'endpapers: img.png', 'otra-clave: img.png', '---'].join('\n');
    const result = rewriteImagePaths(content, map, docDir);
    expect(result).toContain(`title-image: "${processed}"`);
    expect(result).toContain(`publishers-image: '${processed}'`);
    expect(result).toContain(`endpapers: ${processed}`);
    expect(result).toContain('otra-clave: img.png');
  });

  it('calcula la ruta relativa sin asumir prefijo (imagen fuera del directorio del doc)', () => {
    const mapa = new Map([['/proyecto/shared/img.png', '/proyecto/shared/img.jpg']]);
    const result = rewriteImagePaths('![x](../shared/img.png)', mapa, docDir);
    expect(result).toBe('![x](/proyecto/shared/img.jpg)');
  });

  it('sin imágenes en el mapa retorna el contenido intacto', () => {
    expect(rewriteImagePaths('![a](img.png)', new Map(), docDir)).toBe('![a](img.png)');
  });
});
