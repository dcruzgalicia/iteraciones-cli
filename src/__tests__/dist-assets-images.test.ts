import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

/**
 * #2435: las imágenes procesadas con ImageMagick viven en
 * <outputDir>/<nivel>/assets/img/ (un assets por nivel de salida: la raíz en
 * dist/files/assets/img y cada subcarpeta en su propio assets) y todos los
 * formatos exportados (HTML, markdown, EPUB) las referencian como
 * ./assets/img/<nombre>, igual en todos los niveles. Sin esto, dist
 * referenciaba rutas del proyecto fuente: quebraba la portabilidad de dist y
 * la idempotencia al reprocesar los markdowns exportados como si fueran origen.
 *
 * Requiere pandoc + ImageMagick; sin ellos, skip informado (decisión D3).
 */
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('dist-assets-images.test.ts', SKIP_REASONS.pandoc);

const magickOk = await Bun.spawn(['magick', '-version'], { stdout: 'ignore', stderr: 'ignore' })
  .exited.then((c) => c === 0)
  .catch(() => false);
if (!magickOk) registerSkip('dist-assets-images.test.ts', SKIP_REASONS.magick);

describe.skipIf(!pandocOk || !magickOk)('imágenes procesadas en dist (#2435)', () => {
  it('dist contiene assets/img y HTML/markdown referencian assets/img/<nombre>', async () => {
    await withTempDir(async (dir) => {
      const config = [
        'language: es-MX',
        'format:',
        '  html:',
        '    site:',
        '      title: T',
        '    generate: true',
        '  markdown:',
        '    generate: true',
      ].join('\n');
      await Bun.write(join(dir, 'iteraciones.config.yaml'), `${config}\n`);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:white', join(dir, 'foto.png')]);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:gray', join(dir, 'portada.png')]);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:gray', join(dir, 'editorial.png')]);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:gray', join(dir, 'frontis.png')]);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:gray', join(dir, 'referencia.png')]);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:gray', join(dir, 'crudo.png')]);
      // #2441: fm escalar, lista y multilinea + referencia [id]: + <img crudo>.
      const doc = [
        '---',
        'title: Ejemplo',
        'slug: ejemplo',
        'titleImage: portada.png',
        'publisherImage:',
        '  - editorial.png',
        'frontispiece: |',
        '  ![Frontis](frontis.png)',
        '---',
        '',
        '# Capítulo',
        '',
        '![foto](foto.png)',
        '',
        'Referencia: ![ref][r]',
        '',
        '[r]: referencia.png',
        '',
        '<img src="crudo.png" alt="crudo">',
        '',
      ].join('\n');
      await Bun.write(join(dir, 'manuscrito.md'), `${doc}\n`);
      // Documento anidado con su imagen: su assets vive en su propio nivel.
      const anexo = ['---', 'title: Anexo', 'slug: anexo', '---', '', '# Anexo', '', '![gráfica](grafico.png)', ''].join('\n');
      await Bun.write(join(dir, 'sub', 'anexo.md'), `${anexo}\n`);
      await Bun.spawnSync(['magick', '-size', '2x2', 'xc:black', join(dir, 'sub', 'grafico.png')]);

      process.exitCode = 0;
      const { runBuild } = await import('../cli/dispatcher.js');
      await runBuild(dir);

      const dist = join(dir, 'dist', 'files');
      // 1. La imagen procesada existe en dist/assets/img con nombre final.
      expect(await Bun.file(join(dist, 'assets', 'img', 'foto.jpg')).exists()).toBe(true);
      // 2. HTML y markdown la referencian relativa a sus salidas.
      expect(await Bun.file(join(dist, 'ejemplo.html')).text()).toContain('assets/img/foto.jpg');
      expect(await Bun.file(join(dist, 'ejemplo.md')).text()).toContain('assets/img/foto.jpg');
      // 3. Nivel anidado: su imagen se procesa en SU assets/img y sus salidas
      //    la referencian igual que la raíz (sin subir con ../).
      expect(await Bun.file(join(dist, 'sub', 'assets', 'img', 'grafico.jpg')).exists()).toBe(true);
      expect(await Bun.file(join(dist, 'sub', 'anexo.html')).text()).toContain('./assets/img/grafico.jpg');
      expect(await Bun.file(join(dist, 'sub', 'anexo.html')).text()).not.toContain('../assets/img/grafico.jpg');
      expect(await Bun.file(join(dist, 'sub', 'anexo.md')).text()).toContain('./assets/img/grafico.jpg');
      // 4. #2441: el fm del markdown exportado (escalar, lista, multilinea) y
      //    las formas ![ref][id] / <img crudo> del body apuntan a assets.
      const md = await Bun.file(join(dist, 'ejemplo.md')).text();
      expect(md).toContain('titleImage: ./assets/img/portada.jpg');
      expect(md).toContain('- ./assets/img/editorial.jpg');
      expect(md).toContain('./assets/img/frontis.jpg');
      expect(md).toContain('./assets/img/referencia.jpg');
      expect(md).toContain('src="./assets/img/crudo.jpg"');
      expect(md).not.toContain('portada.png');
      expect(md).not.toContain('editorial.png');
      expect(md).not.toContain('frontis.png');
      expect(md).not.toContain('referencia.png');
      expect(md).not.toContain('crudo.png');
      const html = await Bun.file(join(dist, 'ejemplo.html')).text();
      expect(html).toContain('./assets/img/referencia.jpg');
      expect(html).toContain('./assets/img/crudo.jpg');
    });
  }, 120_000);
});
