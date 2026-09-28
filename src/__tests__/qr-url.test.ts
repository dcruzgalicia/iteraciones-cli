import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execPandoc, getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2457 — la URL del QR ya no pasa por el shell: va por stdin a `pandoc.pipe`,
 * con el png → jpg dentro de `qr-gen.ts` y caché por URL (`qr-<md5(url)>.jpg`).
 *
 * Regresión a cubrir: una URL corriente con `&` genera su `.jpg` (antes
 * `io.popen('echo ' .. url …)` partía la línea y el QR desaparecía en silencio)
 * y con la caché de esa URL presente no se vuelve a invocar a `magick`.
 *
 * Requiere pandoc + ImageMagick (zxing-wasm viene en package.json); sin ellos,
 * skip informado (decisión D3).
 */
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('qr-url.test.ts', SKIP_REASONS.pandoc);

const magickOk = await Bun.spawn(['magick', '-version'], { stdout: 'ignore', stderr: 'ignore' })
  .exited.then((c) => c === 0)
  .catch(() => false);
if (!magickOk) registerSkip('qr-url.test.ts', SKIP_REASONS.magick);

const FILTER = join(import.meta.dir, '..', 'lib', 'resources', 'filters', 'semantic', 'ast', '03-qr-url.lua');
const CON_AMPERSAND = '[https://x.com/a?b=1&c=2]{.qr width="15mm"}\n';

describe.skipIf(!pandocOk || !magickOk)('QR sin shell y caché por URL (#2457)', () => {
  /** Renderiza `md` con el filtro, con `ITERACIONES_PROJECT_ROOT` = `dir`. */
  function render(dir: string, md: string): Promise<string> {
    const sourcePath = join(dir, 'doc.md');
    return execPandoc({ input: md, sourcePath, to: 'latex', extraArgs: ['--lua-filter', FILTER] });
  }

  function processedDir(dir: string): string {
    return join(dir, '.iteraciones', 'processed-images');
  }

  function entries(dir: string): string[] {
    return readdirSync(processedDir(dir)).sort();
  }

  it('genera su .jpg con una URL que lleva & (antes la línea de shell se partía y no salía nada)', async () => {
    await withTempDir(async (dir) => {
      const tex = await render(dir, CON_AMPERSAND);
      // Solo queda el .jpg: el png y el svg intermedios los consume el propio script.
      expect(entries(dir)).toHaveLength(1);
      expect(entries(dir)[0]).toStartWith('qr-');
      expect(entries(dir)[0]).toEndWith('.jpg');
      expect(tex).toContain(join(processedDir(dir), entries(dir)[0] ?? ''));
    });
  });

  it('con la caché de esa URL ya presente no regenera: no vuelve a llamar a magick', async () => {
    await withTempDir(async (dir) => {
      await render(dir, CON_AMPERSAND);
      const jpg = entries(dir)[0] ?? '';
      const path = join(processedDir(dir), jpg);
      // Si se regenerara, el sentinel se pisaría.
      writeFileSync(path, 'SENTINEL');

      const tex = await render(dir, CON_AMPERSAND);

      expect(readFileSync(path, 'utf8')).toBe('SENTINEL');
      expect(tex).toContain(path);
      expect(entries(dir)).toHaveLength(1);
    });
  });

  it('una URL con ; no ejecuta nada: la URL no toca el shell', async () => {
    await withTempDir(async (dir) => {
      const marker = join(dir, 'pwned.txt');
      await render(dir, `[https://x.com/a;touch ${marker}]{.qr width="15mm"}\n`);
      expect(existsSync(marker)).toBe(false);
      expect(entries(dir)).toHaveLength(1);
    });
  });
});
