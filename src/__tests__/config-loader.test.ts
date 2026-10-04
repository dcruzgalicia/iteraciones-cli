import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_EPUB_FORMAT, DEFAULT_HTML_FORMAT, DEFAULT_MARKDOWN_FORMAT, DEFAULT_PDF_FORMAT, DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { withTempDir } from './helpers.js';

async function writeConfig(dir: string, content: string): Promise<void> {
  await writeFile(join(dir, 'iteraciones.config.yaml'), content, 'utf8');
}

describe('loadSiteConfig', () => {
  it('configuración completa y compleja se parsea correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(
        dir,
        [
          'language: es-MX',
          'format:',
          '  latex:',
          '    generate: true',
          '  pdf:',
          '    generate: true',
          '    showDate: true',
          '  html:',
          '    site:',
          '      title: Mi Sitio',
          '      description: mi tagline',
          '      logo: logo.svg',
          '      theme: dark',
          '      color: rose',
          '    generate: true',
          '  epub:',
          '    generate: true',
          '  markdown:',
          '    generate: false',
          'toc: true',
          'disabledFilters:',
          '  - semantic/string/01-double-colon',
        ].join('\n'),
      );
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.site?.title).toBe('Mi Sitio');
      expect(config.format.html?.site?.description).toBe('mi tagline');
      expect(config.language).toBe('es-MX');
      expect(config.format.html?.site?.logo).toBe('logo.svg');
      expect(config.format.latex?.generate).toBe(true);
      expect(config.format.pdf?.generate).toBe(true);
      expect(config.format.pdf?.showDate).toBe(true);
      expect(config.toc).toBe(true);
      expect(config.format.html?.generate).toBe(true);
      expect(config.format.html?.site?.theme).toBe('dark');
      expect(config.format.html?.site?.color).toBe('rose');
      expect(config.format.epub?.generate).toBe(true);
      expect(config.format.markdown?.generate).toBe(false);
      expect(config.disabledFilters).toEqual(['semantic/string/01-double-colon']);
    });
  });

  // ── Tests de las tres vías de carga (cubren la unificación de defaults) ──

  it('format.latex.generate es false con config presente sin clave latex (vía 1)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'language: es-MX');
      const config = await loadSiteConfig(dir);
      expect(config.format.latex?.generate).toBe(false);
    });
  });

  it('format.html.generate es true con format: {} (vía 2)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format: {}');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.generate).toBe(true);
    });
  });

  it('las vías de carga (vacío, mínimo) producen los mismos defaults de formato', async () => {
    const results: SiteConfig[] = [];
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      results.push(await loadSiteConfig(dir));
    });
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'language: es-MX');
      results.push(await loadSiteConfig(dir));
    });

    const [defaultsConArchivoVacio, defaultsConMinimo] = results;
    if (!defaultsConArchivoVacio || !defaultsConMinimo) {
      throw new Error('falló la carga de defaults en alguna vía');
    }

    // Los defaults de formato deben coincidir en todas las vías
    expect(defaultsConMinimo.format.latex).toEqual(defaultsConArchivoVacio.format.latex);
    expect(defaultsConMinimo.format.html?.generate).toBe(defaultsConArchivoVacio.format.html?.generate);
    expect(defaultsConMinimo.format?.pdf?.disabledPreambleFilters).toEqual(defaultsConArchivoVacio.format?.pdf?.disabledPreambleFilters);
  });

  it('los defaults del esquema coinciden con las constantes DEFAULT_* (fuente única, sin materializar PDF)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      const config = await loadSiteConfig(dir);
      expect(config.language).toBe(DEFAULT_SITE_CONFIG.language);
      expect(config.toc).toBe(DEFAULT_SITE_CONFIG.toc);
      expect(config.format.latex).toEqual(DEFAULT_SITE_CONFIG.format.latex);
      expect(config.format.html).toEqual(DEFAULT_HTML_FORMAT);
      expect(config.format.pdf?.generate).toBe(DEFAULT_PDF_FORMAT.generate);
      expect(config.format.epub).toEqual(DEFAULT_EPUB_FORMAT);
      expect(config.format.markdown).toEqual(DEFAULT_MARKDOWN_FORMAT);
    });
  });

  it('el tema por defecto es dark con config vacía y con config sin la clave', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      expect((await loadSiteConfig(dir)).format.html?.site?.theme).toBe('dark');
    });
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    site:\n      title: ok');
      expect((await loadSiteConfig(dir)).format.html?.site?.theme).toBe('dark');
    });
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    site:\n      theme: light');
      expect((await loadSiteConfig(dir)).format.html?.site?.theme).toBe('light');
    });
  });

  it('lee format.pdf.cover-image y queda sin materializar por defecto', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  pdf:\n    coverImage: true');
      const config = await loadSiteConfig(dir);
      expect(config.format.pdf?.coverImage).toBe(true);
    });
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      const config = await loadSiteConfig(dir);
      expect(config.format.pdf?.coverImage).toBeUndefined();
    });
  });
});

describe('loadSiteConfigIfPresent', () => {});

describe('loadSiteConfigWithPresence', () => {});

describe('guard schema↔uso de format.html.site (#2016)', () => {});
