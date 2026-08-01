import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { ConfigError } from '../lib/errors.js';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'iteraciones-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeConfig(dir: string, content: string): Promise<void> {
  await writeFile(join(dir, '_iteraciones.yaml'), content, 'utf8');
}

describe('loadSiteConfig', () => {
  it('retorna defaults cuando no existe _iteraciones.yaml', async () => {
    await withTempDir(async (dir) => {
      const config = await loadSiteConfig(dir);
      expect(config.title).toBe('iteraciones');
      expect(config.tagline).toBe('escribir, compartir, re-existir');
      expect(config.lang).toBe('es-MX');
      expect(config.logo).toBe('');
      expect(config.baseUrl).toBeUndefined();
      expect(config.disabledTranspilers).toBeUndefined();
      expect(config.disabledPreambleTranspilers).toBeUndefined();
      expect(config.format.latex).toBe(true);
      expect(config.format.html?.generate).toBe(false);
      expect(config.format.pdf?.generate).toBe(false);
      expect(config.format.epub?.generate).toBe(false);
      expect(config.format.markdown?.generate).toBe(false);
    });
  });

  it('retorna defaults cuando el archivo está vacío', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      const config = await loadSiteConfig(dir);
      expect(config.title).toBe('iteraciones');
    });
  });

  it('retorna defaults cuando el YAML no es un objeto', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'solo-un-string');
      const config = await loadSiteConfig(dir);
      expect(config.title).toBe('iteraciones');
    });
  });

  it('lanza ConfigError cuando el YAML tiene sintaxis inválida', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'site: [mal formado');
      expect(loadSiteConfig(dir)).rejects.toThrow(ConfigError);
    });
  });

  it('lee site.title correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'site:\n  title: Mi Título');
      const config = await loadSiteConfig(dir);
      expect(config.title).toBe('Mi Título');
    });
  });

  it('lee site.tagline correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'site:\n  tagline: mi frase');
      const config = await loadSiteConfig(dir);
      expect(config.tagline).toBe('mi frase');
    });
  });

  it('lee site.lang correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'site:\n  lang: en-US');
      const config = await loadSiteConfig(dir);
      expect(config.lang).toBe('en-US');
    });
  });

  it('lee site.logo correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'site:\n  logo: assets/logo.svg');
      const config = await loadSiteConfig(dir);
      expect(config.logo).toBe('assets/logo.svg');
    });
  });

  it('lee site.base-url correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'site:\n  base-url: https://ejemplo.com');
      const config = await loadSiteConfig(dir);
      expect(config.baseUrl).toBe('https://ejemplo.com');
    });
  });

  it('ignora base-url vacío y retorna undefined', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'site:\n  base-url: ""');
      const config = await loadSiteConfig(dir);
      expect(config.baseUrl).toBeUndefined();
    });
  });

  it('lee disabled-transpilers', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'disabled-transpilers:\n  - semantic/string/01-double-colon\n  - latex/02-dictum');
      const config = await loadSiteConfig(dir);
      expect(config.disabledTranspilers).toEqual(['semantic/string/01-double-colon', 'latex/02-dictum']);
    });
  });

  it('ignora disabled-transpilers vacío', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'disabled-transpilers: []');
      const config = await loadSiteConfig(dir);
      expect(config.disabledTranspilers).toBeUndefined();
    });
  });

  it('lee disabled-preamble-transpilers', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'disabled-preamble-transpilers:\n  - 01-maketitle-patches');
      const config = await loadSiteConfig(dir);
      expect(config.disabledPreambleTranspilers).toEqual(['01-maketitle-patches']);
    });
  });

  it('activa format.latex con true', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  latex: true');
      const config = await loadSiteConfig(dir);
      expect(config.format.latex).toBe(true);
    });
  });

  it('desactiva format.latex con false', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  latex: false');
      const config = await loadSiteConfig(dir);
      expect(config.format.latex).toBe(false);
    });
  });

  it('activa format.html con generate: true', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    generate: true\n    theme: light\n    accent: blue');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.generate).toBe(true);
      expect(config.format.html?.theme).toBe('light');
      expect(config.format.html?.accent).toBe('blue');
    });
  });

  it('activa format.pdf con generate: true', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  pdf:\n    generate: true');
      const config = await loadSiteConfig(dir);
      expect(config.format.pdf?.generate).toBe(true);
    });
  });

  it('activa format.epub con generate: true', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  epub:\n    generate: true');
      const config = await loadSiteConfig(dir);
      expect(config.format.epub?.generate).toBe(true);
    });
  });

  it('activa format.markdown con generate: true', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  markdown:\n    generate: true');
      const config = await loadSiteConfig(dir);
      expect(config.format.markdown?.generate).toBe(true);
    });
  });

  it('configuración completa y compleja se parsea correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(
        dir,
        [
          'site:',
          '  title: Mi Sitio',
          '  tagline: mi tagline',
          '  lang: es-MX',
          '  logo: logo.svg',
          '  base-url: https://ejemplo.com',
          'format:',
          '  latex: true',
          '  pdf:',
          '    generate: true',
          '    toc: true',
          '    show-date: true',
          '  html:',
          '    generate: true',
          '    theme: dark',
          '    accent: rose',
          '  epub:',
          '    generate: true',
          '  markdown:',
          '    generate: false',
          'disabled-transpilers:',
          '  - semantic/string/01-double-colon',
        ].join('\n'),
      );
      const config = await loadSiteConfig(dir);
      expect(config.title).toBe('Mi Sitio');
      expect(config.tagline).toBe('mi tagline');
      expect(config.lang).toBe('es-MX');
      expect(config.logo).toBe('logo.svg');
      expect(config.baseUrl).toBe('https://ejemplo.com');
      expect(config.format.latex).toBe(true);
      expect(config.format.pdf?.generate).toBe(true);
      expect(config.format.pdf?.toc).toBe(true);
      expect(config.format.pdf?.showDate).toBe(true);
      expect(config.format.html?.generate).toBe(true);
      expect(config.format.html?.theme).toBe('dark');
      expect(config.format.html?.accent).toBe('rose');
      expect(config.format.epub?.generate).toBe(true);
      expect(config.format.markdown?.generate).toBe(false);
      expect(config.disabledTranspilers).toEqual(['semantic/string/01-double-colon']);
    });
  });

  it('parsea format.pdf con generate:true y aplica defaults para campos no especificados', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  pdf:\n    generate: true');
      const config = await loadSiteConfig(dir);
      expect(config.format.pdf?.generate).toBe(true);
      // pdfx, toc, crop, etc. tienen fallback directo a DEFAULT_PDF_FORMAT
      expect(config.format.pdf?.pdfx).toBe(false);
      expect(config.format.pdf?.toc).toBe(false);
      expect(config.format.pdf?.crop).toBe(false);
    });
  });

  it('parsea color de acento inválido con valor por defecto', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    accent: color-inventado');
      const config = await loadSiteConfig(dir);
      // El código existente usa 'lime' como fallback y escribe en stderr
      expect(config.format.html?.accent).toBe('lime');
    });
  });
});
