import { describe, expect, it, spyOn } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as buildAssetsModule from '../builder/build-assets.js';
import { buildAssets, computeCssHash } from '../builder/build-assets.js';
import { cleanupDeletedFiles, cleanupRemovedFormats, cleanupSlugChanges } from '../builder/cleanup.js';
import type { BuildContext } from '../builder/types.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { withTempDir } from './helpers.js';

function makeCtx(cwd: string): BuildContext {
  return { cwd, siteConfig: DEFAULT_SITE_CONFIG, outputDir: join(cwd, 'dist', 'files'), concurrency: 2, needsCss: false };
}

describe('build-assets', () => {
  it('buildAssets genera css/styles.css, fuentes y logo en el directorio de salida', async () => {
    await withTempDir(async (dir) => {
      const outDir = join(dir, 'dist', 'files');
      await buildAssets(outDir, dir, DEFAULT_SITE_CONFIG);
      expect(await Bun.file(join(outDir, 'css', 'styles.css')).exists()).toBe(true);
      expect(await Bun.file(join(outDir, 'logo.svg')).exists()).toBe(true);
      const fonts = [...new Bun.Glob('*.ttf').scanSync({ cwd: join(outDir, 'fonts') })];
      expect(fonts.length).toBeGreaterThan(0);
      const css = await Bun.file(join(outDir, 'css', 'styles.css')).text();
      // El CSS final incluye el CSS custom del input (fuentes y animaciones)
      expect(css).toContain('@font-face');
      expect(css).toContain('url(../fonts/'); // rutas relativas al css final → dist/files/fonts
      expect(css).toContain('@keyframes scroll-reveal');
    });
  });

  it('computeCssHash incluye el binario de Tailwind (una actualización invalida el CSS)', async () => {
    await withTempDir(async (dir) => {
      const outDir = join(dir, 'dist', 'files');
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'index.html'), '<p class="text-stone-500">Hola</p>', 'utf8');
      const fakeBin = join(dir, 'tailwind-bin.mjs');
      await writeFile(fakeBin, 'a', 'utf8');
      const spy = spyOn(buildAssetsModule, 'resolveTailwindBin').mockResolvedValue(fakeBin);
      try {
        const h1 = await computeCssHash(outDir, DEFAULT_SITE_CONFIG);
        // "Actualizar" el binario: otro contenido (otro mtime y tamaño)
        await Bun.sleep(5);
        await writeFile(fakeBin, 'bb', 'utf8');
        const h2 = await computeCssHash(outDir, DEFAULT_SITE_CONFIG);
        expect(h1.hash).not.toBe(h2.hash);
        // Sin cambios en el binario, el hash es estable (misma salida)
        const h3 = await computeCssHash(outDir, DEFAULT_SITE_CONFIG);
        expect(h2.hash).toBe(h3.hash);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('una segunda llamada no reescribe fuentes ni logo (mtime estable)', async () => {
    await withTempDir(async (dir) => {
      const outDir = join(dir, 'dist', 'files');
      await buildAssets(outDir, dir, DEFAULT_SITE_CONFIG);
      const fonts = [...new Bun.Glob('*.ttf').scanSync({ cwd: join(outDir, 'fonts') })].sort();
      expect(fonts.length).toBeGreaterThan(0);
      const logoStat = await Bun.file(join(outDir, 'logo.svg')).stat();
      const fontMtimes = new Map<string, number>();
      for (const f of fonts) {
        fontMtimes.set(f, (await Bun.file(join(outDir, 'fonts', f)).stat()).mtimeMs);
      }
      await Bun.sleep(10);
      await buildAssets(outDir, dir, DEFAULT_SITE_CONFIG);
      for (const f of fonts) {
        const s = await Bun.file(join(outDir, 'fonts', f)).stat();
        const prev = fontMtimes.get(f);
        if (prev === undefined) throw new Error(`sin mtime previo para ${f}`);
        expect(s.mtimeMs).toBe(prev);
      }
      const logoStat2 = await Bun.file(join(outDir, 'logo.svg')).stat();
      expect(logoStat2.mtimeMs).toBe(logoStat.mtimeMs);
    });
  });

  it('un logo de proyecto modificado se re-copia', async () => {
    await withTempDir(async (dir) => {
      const outDir = join(dir, 'dist', 'files');
      await mkdir(join(dir, 'assets'), { recursive: true });
      await writeFile(join(dir, 'assets', 'mi-logo.svg'), '<svg>A</svg>', 'utf8');
      const config = {
        ...DEFAULT_SITE_CONFIG,
        format: { ...DEFAULT_SITE_CONFIG.format, html: { ...DEFAULT_SITE_CONFIG.format.html, logo: 'assets/mi-logo.svg' } },
      };
      await buildAssets(outDir, dir, config);
      expect(await Bun.file(join(outDir, 'assets', 'mi-logo.svg')).text()).toBe('<svg>A</svg>');
      await Bun.sleep(5);
      await writeFile(join(dir, 'assets', 'mi-logo.svg'), '<svg>B</svg>', 'utf8');
      await buildAssets(outDir, dir, config);
      expect(await Bun.file(join(outDir, 'assets', 'mi-logo.svg')).text()).toBe('<svg>B</svg>');
    });
  });
});

describe('cleanup (eliminaciones y slugs)', () => {
  it('cleanupDeletedFiles elimina el área de trabajo del PDF y la salida del documento', async () => {
    await withTempDir(async (dir) => {
      const ctx = makeCtx(dir);
      // Simular artefactos de un documento 'perdido.md' (slug 'perdido')
      await mkdir(join(dir, '.iteraciones', 'tmp', 'pdf'), { recursive: true });
      await mkdir(join(ctx.outputDir), { recursive: true });
      await writeFile(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.tex'), 'tex');
      await writeFile(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.aux'), 'aux');
      await writeFile(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.log'), 'log');
      await writeFile(join(ctx.outputDir, 'perdido.html'), 'html');

      const deletedEntries = new Map([['perdido.md', { title: 'Perdido', author: [], date: '', mtime: 0, size: 0, hash: '', slug: 'perdido' }]]);
      await cleanupDeletedFiles(ctx, new Set(['perdido.md']), [], deletedEntries);

      expect(await Bun.file(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.tex')).exists()).toBe(false);
      expect(await Bun.file(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.aux')).exists()).toBe(false);
      expect(await Bun.file(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.log')).exists()).toBe(false);
      expect(await Bun.file(join(ctx.outputDir, 'perdido.html')).exists()).toBe(false);
    });
  });

  it('cleanupDeletedFiles limpia todas las salidas index.* de un index.md eliminado', async () => {
    await withTempDir(async (dir) => {
      const ctx = makeCtx(dir);
      await mkdir(join(ctx.outputDir), { recursive: true });
      for (const ext of ['html', 'pdf', 'tex', 'epub', 'md']) {
        await writeFile(join(ctx.outputDir, `index.${ext}`), ext, 'utf8');
      }
      await writeFile(join(ctx.outputDir, 'otro.html'), 'otro', 'utf8');

      const deletedEntries = new Map([['index.md', { title: 'Inicio', author: [], date: '', mtime: 0, size: 0, hash: '', slug: 'inicio' }]]);
      await cleanupDeletedFiles(ctx, new Set(['index.md']), [], deletedEntries);

      for (const ext of ['html', 'pdf', 'tex', 'epub', 'md']) {
        expect(await Bun.file(join(ctx.outputDir, `index.${ext}`)).exists()).toBe(false);
      }
      expect(await Bun.file(join(ctx.outputDir, 'otro.html')).exists()).toBe(true);
    });
  });

  it('cleanupSlugChanges elimina los artefactos del slug anterior', async () => {
    await withTempDir(async (dir) => {
      const ctx = makeCtx(dir);
      await mkdir(join(ctx.outputDir), { recursive: true });
      await writeFile(join(ctx.outputDir, 'slug-viejo.html'), 'html');

      await cleanupSlugChanges(ctx, new Map([['doc.md', 'slug-viejo']]));

      expect(await Bun.file(join(ctx.outputDir, 'slug-viejo.html')).exists()).toBe(false);
    });
  });

  it('cleanupRemovedFormats elimina las salidas del formato y los assets de html', async () => {
    await withTempDir(async (dir) => {
      const ctx = makeCtx(dir);
      await mkdir(join(ctx.outputDir, 'css'), { recursive: true });
      await mkdir(join(ctx.outputDir, 'fonts'), { recursive: true });
      await writeFile(join(ctx.outputDir, 'doc.html'), 'html');
      await writeFile(join(ctx.outputDir, 'doc.pdf'), 'pdf');
      await writeFile(join(ctx.outputDir, 'doc.tex'), 'tex');
      await writeFile(join(ctx.outputDir, 'css', 'styles.css'), 'css');
      await writeFile(join(ctx.outputDir, 'fonts', 'x.ttf'), 'font');
      await writeFile(join(ctx.outputDir, 'logo.svg'), 'logo');
      const doc = { relativePath: 'doc.md', slug: 'doc' } as never;

      await cleanupRemovedFormats(ctx, [doc], ['html']);

      expect(await Bun.file(join(ctx.outputDir, 'doc.html')).exists()).toBe(false);
      expect(await Bun.file(join(ctx.outputDir, 'doc.pdf')).exists()).toBe(true);
      expect(await Bun.file(join(ctx.outputDir, 'doc.tex')).exists()).toBe(true);
      // Los assets de HTML se limpian junto con el formato
      expect(await Bun.file(join(ctx.outputDir, 'css')).exists()).toBe(false);
      expect(await Bun.file(join(ctx.outputDir, 'fonts')).exists()).toBe(false);
      expect(await Bun.file(join(ctx.outputDir, 'logo.svg')).exists()).toBe(false);
    });
  });
});
