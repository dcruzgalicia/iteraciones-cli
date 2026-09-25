import { describe, expect, it, spyOn } from 'bun:test';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as buildAssetsModule from '../builder/build-assets.js';
import { buildAssets, computeCssHash } from '../builder/build-assets.js';
import { cleanupDeletedFiles, cleanupRemovedFormats, cleanupSlugChanges, hasLegacyAssetLayout } from '../builder/cleanup.js';
import { build } from '../builder/orchestrator.js';
import type { BuildContext } from '../builder/types.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS, withTempDir } from './helpers.js';

// El test de migración arranca un build real: sin pandoc, skip informado (D3).
const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('build-assets-cleanup.test.ts', SKIP_REASONS.pandoc);

function makeCtx(cwd: string): BuildContext {
  return { cwd, siteConfig: DEFAULT_SITE_CONFIG, outputDir: join(cwd, 'dist', 'files'), concurrency: 2, needsCss: false };
}

/** Reporter nulo que captura los mensajes de log para el test de migración. */
function capturingReporter(logs: string[]) {
  return {
    setFormats: () => {},
    planPhases: () => Promise.resolve(),
    startPhase: () => {},
    reportFile: () => {},
    completePhase: () => {},
    log: (message: string) => {
      logs.push(message);
    },
    addWarning: () => {},
    addSummaryLine: () => {},
    showCleanup: () => {},
    startLightFormats: () => {},
    finish: () => Promise.resolve(),
    fail: () => Promise.resolve(),
  };
}

describe('build-assets', () => {
  it('buildAssets escribe assets/css, assets/fonts y assets/logo.svg en la salida', async () => {
    await withTempDir(async (dir) => {
      const outDir = join(dir, 'dist', 'files');
      await buildAssets(outDir, dir, DEFAULT_SITE_CONFIG);
      expect(await Bun.file(join(outDir, 'assets', 'css', 'styles.css')).exists()).toBe(true);
      expect(await Bun.file(join(outDir, 'assets', 'logo.svg')).exists()).toBe(true);
      const fonts = [...new Bun.Glob('*.ttf').scanSync({ cwd: join(outDir, 'assets', 'fonts') })];
      expect(fonts.length).toBeGreaterThan(0);
      const css = await Bun.file(join(outDir, 'assets', 'css', 'styles.css')).text();
      // El CSS final incluye el CSS custom del input (fuentes y animaciones)
      expect(css).toContain('@font-face');
      // css y fuentes son hermanos dentro de assets/ → ../fonts sigue resolviendo
      expect(css).toContain('url(../fonts/');
      expect(css).toContain('@keyframes scroll-reveal');
    });
  });

  it('buildAssets copia las licencias OFL de las fuentes junto a los .ttf', async () => {
    await withTempDir(async (dir) => {
      const outDir = join(dir, 'dist', 'files');
      await buildAssets(outDir, dir, DEFAULT_SITE_CONFIG);
      const exo2 = await Bun.file(join(outDir, 'assets', 'fonts', 'OFL-Exo2.txt')).text();
      const spaceMono = await Bun.file(join(outDir, 'assets', 'fonts', 'OFL-SpaceMono.txt')).text();
      expect(exo2).toContain('Copyright 2013 The Exo 2 Project Authors');
      expect(exo2).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(spaceMono).toContain('Copyright 2016 The Space Mono Project Authors');
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
      const fonts = [...new Bun.Glob('*.ttf').scanSync({ cwd: join(outDir, 'assets', 'fonts') })].sort();
      expect(fonts.length).toBeGreaterThan(0);
      const logoStat = await Bun.file(join(outDir, 'assets', 'logo.svg')).stat();
      const fontMtimes = new Map<string, number>();
      for (const f of fonts) {
        fontMtimes.set(f, (await Bun.file(join(outDir, 'assets', 'fonts', f)).stat()).mtimeMs);
      }
      await Bun.sleep(10);
      await buildAssets(outDir, dir, DEFAULT_SITE_CONFIG);
      for (const f of fonts) {
        const s = await Bun.file(join(outDir, 'assets', 'fonts', f)).stat();
        const prev = fontMtimes.get(f);
        if (prev === undefined) throw new Error(`sin mtime previo para ${f}`);
        expect(s.mtimeMs).toBe(prev);
      }
      const logoStat2 = await Bun.file(join(outDir, 'assets', 'logo.svg')).stat();
      expect(logoStat2.mtimeMs).toBe(logoStat.mtimeMs);
    });
  });

  it('un logo de proyecto modificado se re-copia en assets/logo.svg', async () => {
    await withTempDir(async (dir) => {
      const outDir = join(dir, 'dist', 'files');
      await mkdir(join(dir, 'assets'), { recursive: true });
      await writeFile(join(dir, 'assets', 'mi-logo.svg'), '<svg>A</svg>', 'utf8');
      const config = {
        ...DEFAULT_SITE_CONFIG,
        format: {
          ...DEFAULT_SITE_CONFIG.format,
          html: { ...DEFAULT_SITE_CONFIG.format.html, site: { ...DEFAULT_SITE_CONFIG.format.html?.site, logo: 'assets/mi-logo.svg' } },
        },
      };
      await buildAssets(outDir, dir, config);
      expect(await Bun.file(join(outDir, 'assets', 'logo.svg')).text()).toBe('<svg>A</svg>');
      // #2450: la ruta de la config no se replica en dist, el destino es fijo
      expect(await Bun.file(join(outDir, 'assets', 'mi-logo.svg')).exists()).toBe(false);
      await Bun.sleep(5);
      await writeFile(join(dir, 'assets', 'mi-logo.svg'), '<svg>B</svg>', 'utf8');
      await buildAssets(outDir, dir, config);
      expect(await Bun.file(join(outDir, 'assets', 'logo.svg')).text()).toBe('<svg>B</svg>');
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

      const deletedEntries = new Map([['perdido.md', { title: 'Perdido', creator: [], date: '', mtime: 0, size: 0, hash: '', slug: 'perdido' }]]);
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

      const deletedEntries = new Map([['index.md', { title: 'Inicio', creator: [], date: '', mtime: 0, size: 0, hash: '', slug: 'inicio' }]]);
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
      await mkdir(join(ctx.outputDir, 'assets', 'css'), { recursive: true });
      await mkdir(join(ctx.outputDir, 'assets', 'fonts'), { recursive: true });
      await mkdir(join(ctx.outputDir, 'css'), { recursive: true });
      await mkdir(join(ctx.outputDir, 'fonts'), { recursive: true });
      await writeFile(join(ctx.outputDir, 'doc.html'), 'html');
      await writeFile(join(ctx.outputDir, 'doc.pdf'), 'pdf');
      await writeFile(join(ctx.outputDir, 'doc.tex'), 'tex');
      await writeFile(join(ctx.outputDir, 'assets', 'css', 'styles.css'), 'css');
      await writeFile(join(ctx.outputDir, 'assets', 'fonts', 'x.ttf'), 'font');
      await writeFile(join(ctx.outputDir, 'assets', 'logo.svg'), 'logo');
      await writeFile(join(ctx.outputDir, 'css', 'styles.css'), 'css');
      await writeFile(join(ctx.outputDir, 'fonts', 'x.ttf'), 'font');
      await writeFile(join(ctx.outputDir, 'logo.svg'), 'logo');
      const doc = { relativePath: 'doc.md', slug: 'doc' } as never;

      await cleanupRemovedFormats(ctx, [doc], ['html']);

      expect(await Bun.file(join(ctx.outputDir, 'doc.html')).exists()).toBe(false);
      expect(await Bun.file(join(ctx.outputDir, 'doc.pdf')).exists()).toBe(true);
      expect(await Bun.file(join(ctx.outputDir, 'doc.tex')).exists()).toBe(true);
      // Los assets de HTML se limpian junto con el formato: el layout nuevo y
      // los residuos del anterior (#2450). stat, no Bun.file: un directorio
      // vacío seguiría "existiendo" como fichero.
      for (const rel of ['assets/css', 'assets/fonts', 'assets/logo.svg', 'css', 'fonts', 'logo.svg']) {
        const sigue = await stat(join(ctx.outputDir, rel))
          .then(() => true)
          .catch(() => false);
        expect(sigue, `${rel} debía desaparecer`).toBe(false);
      }
    });
  });

  it('hasLegacyAssetLayout distingue la salida vieja de la nueva (#2450)', async () => {
    await withTempDir(async (dir) => {
      const outDir = join(dir, 'dist', 'files');
      expect(await hasLegacyAssetLayout(outDir)).toBe(false);
      await mkdir(join(outDir, 'assets', 'css'), { recursive: true });
      await writeFile(join(outDir, 'assets', 'css', 'styles.css'), 'css');
      expect(await hasLegacyAssetLayout(outDir)).toBe(false);

      for (const legacy of ['css', 'fonts']) {
        await mkdir(join(outDir, legacy), { recursive: true });
        expect(await hasLegacyAssetLayout(outDir)).toBe(true);
        await rm(join(outDir, legacy), { recursive: true, force: true });
      }
      await writeFile(join(outDir, 'logo.svg'), 'logo');
      expect(await hasLegacyAssetLayout(outDir)).toBe(true);
      await rm(join(outDir, 'logo.svg'));

      // Un assets/img anidado también cuenta: los .md de ese nivel lo referencian
      await mkdir(join(outDir, 'sub', 'assets', 'img'), { recursive: true });
      expect(await hasLegacyAssetLayout(outDir)).toBe(true);
    });
  });
});

describe.skipIf(!pandocOk)('migración al layout de assets (#2450)', () => {
  it('una salida con el layout anterior fuerza el rebuild completo', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'iteraciones.config.yaml'),
        'language: es-MX\nformat:\n  html:\n    site:\n      title: T\n    generate: true\n',
        'utf8',
      );
      await writeFile(join(dir, 'doc.md'), '---\ntitle: Doc\n---\n\nHola.\n', 'utf8');
      // Salida construida con el layout anterior: los .md que este build no
      // recompile seguirían apuntando a css/ y a assets/img.
      await mkdir(join(dir, 'dist', 'files', 'css'), { recursive: true });
      await writeFile(join(dir, 'dist', 'files', 'css', 'styles.css'), '.viejo{}', 'utf8');
      await mkdir(join(dir, 'dist', 'files', 'sub', 'assets', 'img'), { recursive: true });

      const logs: string[] = [];
      await build(dir, {}, capturingReporter(logs));

      expect(logs.some((m) => m.includes('layout de assets anterior'))).toBe(true);
      // --full borra dist/files entero: no queda ni el residuo ni su subnivel
      for (const rel of ['css', 'sub']) {
        const sigue = await stat(join(dir, 'dist', 'files', rel))
          .then(() => true)
          .catch(() => false);
        expect(sigue, `${rel} debía desaparecer`).toBe(false);
      }
      // y la salida nueva queda con el layout de #2450
      expect(await Bun.file(join(dir, 'dist', 'files', 'assets', 'css', 'styles.css')).exists()).toBe(true);
      expect(await Bun.file(join(dir, 'dist', 'files', 'doc.html')).exists()).toBe(true);
    });
  }, 60_000);
});
