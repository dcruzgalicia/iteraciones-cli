import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetMagickCache, scanTitlePageFieldImages } from '../builder/image-processor.js';

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
    expect(img!.absPath).toEndWith('Images/logo.jpg');
    expect(img!.isSvg).toBe(false);
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
    expect(img!.absPath).toEndWith('Images/logo.jpg');
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
    expect(img!.isSvg).toBe(true);
    expect(img!.attrs).toBe('{width=100pt}');
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
