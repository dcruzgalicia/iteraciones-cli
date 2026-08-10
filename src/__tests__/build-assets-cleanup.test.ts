import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAssets } from '../builder/build-assets.js';
import { cleanupDeletedFiles, cleanupSlugChanges } from '../builder/cleanup.js';
import type { BuildContext } from '../builder/types.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-cli-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

  it('buildAssets con noCss no genera el CSS pero sí logo y fuentes', async () => {
    await withTempDir(async (dir) => {
      const outDir = join(dir, 'dist', 'files');
      await buildAssets(outDir, dir, DEFAULT_SITE_CONFIG, { noCss: true });
      expect(await Bun.file(join(outDir, 'css', 'styles.css')).exists()).toBe(false);
      expect(await Bun.file(join(outDir, 'logo.svg')).exists()).toBe(true);
    });
  });
});

describe('cleanup (eliminaciones y slugs)', () => {
  it('cleanupDeletedFiles elimina el área de trabajo del PDF, la caché de repro y la salida del documento', async () => {
    await withTempDir(async (dir) => {
      const ctx = makeCtx(dir);
      // Simular artefactos de un documento 'perdido.md' (slug 'perdido')
      await mkdir(join(dir, '.iteraciones', 'tmp', 'pdf'), { recursive: true });
      await mkdir(join(dir, '.iteraciones', 'repro', 'html'), { recursive: true });
      await mkdir(join(ctx.outputDir), { recursive: true });
      await writeFile(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.tex'), 'tex');
      await writeFile(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.aux'), 'aux');
      await writeFile(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.log'), 'log');
      await writeFile(join(dir, '.iteraciones', 'repro', 'html', 'perdido.sh'), 'sh');
      await writeFile(join(ctx.outputDir, 'perdido.html'), 'html');

      const deletedEntries = new Map([['perdido.md', { title: 'Perdido', author: [], date: '', mtime: 0, size: 0, hash: '', slug: 'perdido' }]]);
      await cleanupDeletedFiles(ctx, new Set(['perdido.md']), [], deletedEntries);

      expect(await Bun.file(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.tex')).exists()).toBe(false);
      expect(await Bun.file(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.aux')).exists()).toBe(false);
      expect(await Bun.file(join(dir, '.iteraciones', 'tmp', 'pdf', 'perdido.log')).exists()).toBe(false);
      expect(await Bun.file(join(dir, '.iteraciones', 'repro', 'html', 'perdido.sh')).exists()).toBe(false);
      expect(await Bun.file(join(ctx.outputDir, 'perdido.html')).exists()).toBe(false);
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
});
