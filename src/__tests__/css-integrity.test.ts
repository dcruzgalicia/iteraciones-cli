import { describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileTailwindCss, resolveTailwindBin } from '../builder/build-assets.js';
import { withTempDir } from './helpers.js';

/**
 * El CSS se compila escaneando SOLO los HTML de dist/files: el fixture
 * controla qué clases deben aparecer (presentes en el HTML) y cuáles no
 * (ausentes, incluidas las de un CSS previo que no debe auto-referenciarse).
 */
describe('compilación de Tailwind sobre dist/files', () => {
  it('resuelve el binario del CLI por módulos y apunta a un archivo existente', async () => {
    const bin = await resolveTailwindBin();
    expect(bin).toContain('@tailwindcss');
    expect(await Bun.file(bin).exists()).toBe(true);
  });
  it('incluye las clases del HTML final y el acento configurado; purga las ausentes', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'css'), { recursive: true });
      await writeFile(
        join(dir, 'index.html'),
        '<!DOCTYPE html><html class="bg-stone-200 text-accent-500"><body class="prose grid grid-cols-2">Hola</body></html>',
        'utf8',
      );
      // CSS previo con una clase que ya no está en el HTML: no debe
      // auto-referenciarse (purga exacta).
      await writeFile(join(dir, 'css', 'styles.css'), '.clase-fantasma{color:red}', 'utf8');

      await compileTailwindCss(dir, 'rose');

      const css = await Bun.file(join(dir, 'css', 'styles.css')).text();
      expect(css).toContain('bg-stone-200');
      expect(css).toContain('grid-cols-2');
      expect(css).toContain('.prose');
      // El acento configurado (rose) se compila directamente, sin overrides
      expect(css).toContain('oklch(64.5% .246 16.439)'); // rose-500
      expect(css).not.toContain('clase-fantasma');
      // El marcador :: (Div.spacer) tiene regla propia: no es una utilidad de
      // Tailwind, viene del CSS base de entrada.
      expect(css).toContain('.spacer');
    });
  });

  it('no incluye clases que no están en ningún HTML de dist/files', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'index.html'), '<p class="text-stone-500">Hola</p>', 'utf8');
      await compileTailwindCss(dir, 'lime');
      const css = await Bun.file(join(dir, 'css', 'styles.css')).text();
      expect(css).toContain('text-stone-500');
      expect(css).not.toContain('clase-inexistente-en-html');
    });
  });

  it('un acento desconocido produce error de build', async () => {
    await withTempDir(async (dir) => {
      await expect(compileTailwindCss(dir, 'color-inventado')).rejects.toThrow('acento desconocido');
    });
  });
});
