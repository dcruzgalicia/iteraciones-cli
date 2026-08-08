import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_FORMAT,
  DEFAULT_MARKDOWN_FORMAT,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
  type SiteConfig,
} from '../config/site-config.js';
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
  await writeFile(join(dir, 'iteraciones.config.yaml'), content, 'utf8');
}

describe('loadSiteConfig', () => {
  it('retorna defaults cuando no existe iteraciones.config.yaml', async () => {
    await withTempDir(async (dir) => {
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.title).toBe('iteraciones');
      expect(config.format.html?.tagline).toBe('escribir, compartir, re-existir');
      expect(config.lang).toBe('es-MX');
      expect(config.format.html?.logo).toBe('');
      expect(config.disabledFilters).toBeUndefined();
      expect(config.format?.pdf?.disabledPreambleFilters).toEqual(['24-eso-pic', '25-pdfx', '26-crop']);
      expect(config.format.latex).toBe(false);
      expect(config.format.html?.generate).toBe(true);
      expect(config.format.pdf?.generate).toBe(false);
      expect(config.format.epub?.generate).toBe(false);
      expect(config.format.markdown?.generate).toBe(false);
    });
  });

  it('retorna defaults cuando el archivo está vacío', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.title).toBe('iteraciones');
    });
  });

  it('retorna defaults cuando el YAML no es un objeto', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'solo-un-string');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.title).toBe('iteraciones');
    });
  });

  it('lanza ConfigError cuando el YAML tiene sintaxis inválida', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format: [mal formado');
      expect(loadSiteConfig(dir)).rejects.toThrow(ConfigError);
    });
  });

  it('lee format.html.title correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    title: Mi Título');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.title).toBe('Mi Título');
    });
  });

  it('lee format.html.tagline correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    tagline: mi frase');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.tagline).toBe('mi frase');
    });
  });

  it('lee lang correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'lang: en-US');
      const config = await loadSiteConfig(dir);
      expect(config.lang).toBe('en-US');
    });
  });

  it('lee format.html.logo correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    logo: assets/logo.svg');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.logo).toBe('assets/logo.svg');
    });
  });

  it('lee disabled-filters', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'disabled-filters:\n  - semantic/string/01-double-colon\n  - latex/02-dictum');
      const config = await loadSiteConfig(dir);
      expect(config.disabledFilters).toEqual(['semantic/string/01-double-colon', 'latex/02-dictum']);
    });
  });

  it('ignora disabled-filters vacío', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'disabled-filters: []');
      const config = await loadSiteConfig(dir);
      expect(config.disabledFilters).toBeUndefined();
    });
  });

  it('lee disabled-preamble-filters', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  pdf:\n    disabled-preamble-filters:\n      - 19-maketitle');
      const config = await loadSiteConfig(dir);
      expect(config.format?.pdf?.disabledPreambleFilters).toEqual(['19-maketitle']);
    });
  });

  it('lee lua-filters', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'lua-filters:\n  - filters/mi-filtro.lua');
      const config = await loadSiteConfig(dir);
      expect(config.luaFilters).toEqual(['filters/mi-filtro.lua']);
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
          'lang: es-MX',
          'format:',
          '  latex: true',
          '  pdf:',
          '    generate: true',
          '    toc: true',
          '    show-date: true',
          '  html:',
          '    title: Mi Sitio',
          '    tagline: mi tagline',
          '    logo: logo.svg',
          '    generate: true',
          '    theme: dark',
          '    accent: rose',
          '  epub:',
          '    generate: true',
          '  markdown:',
          '    generate: false',
          'toc: true',
          'disabled-filters:',
          '  - semantic/string/01-double-colon',
        ].join('\n'),
      );
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.title).toBe('Mi Sitio');
      expect(config.format.html?.tagline).toBe('mi tagline');
      expect(config.lang).toBe('es-MX');
      expect(config.format.html?.logo).toBe('logo.svg');
      expect(config.format.latex).toBe(true);
      expect(config.format.pdf?.generate).toBe(true);
      expect(config.format.pdf?.showDate).toBe(true);
      expect(config.toc).toBe(true);
      expect(config.format.html?.generate).toBe(true);
      expect(config.format.html?.theme).toBe('dark');
      expect(config.format.html?.accent).toBe('rose');
      expect(config.format.epub?.generate).toBe(true);
      expect(config.format.markdown?.generate).toBe(false);
      expect(config.disabledFilters).toEqual(['semantic/string/01-double-colon']);
    });
  });

  it('parsea format.pdf con generate:true y aplica defaults para campos no especificados', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  pdf:\n    generate: true');
      const config = await loadSiteConfig(dir);
      expect(config.format.pdf?.generate).toBe(true);
      expect(config.toc).toBe(false);
      expect(config.format.pdf?.showDate).toBe(false);
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

  it('advierte sobre claves desconocidas en format.pdf sin romper el build', async () => {
    const stderrSpy = spyOn(process.stderr, 'write');
    let output = '';
    try {
      await withTempDir(async (dir) => {
        // mathptmx es la clave de la documentación antigua; ya no existe en el esquema
        await writeConfig(dir, 'format:\n  pdf:\n    mathptmx: true\n    generate: true');
        const config = await loadSiteConfig(dir);
        expect(config.format.pdf?.generate).toBe(true);
      });
    } finally {
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      stderrSpy.mockRestore();
    }
    expect(output).toContain('claves sin efecto');
    expect(output).toContain('format.pdf');
    expect(output).toContain('mathptmx');
  });

  it('advierte sobre claves desconocidas en la raíz sin romper el build', async () => {
    const stderrSpy = spyOn(process.stderr, 'write');
    let output = '';
    try {
      await withTempDir(async (dir) => {
        await writeConfig(dir, 'clave-inventada: 1\nformat:\n  html:\n    title: ok');
        const config = await loadSiteConfig(dir);
        expect(config.format.html?.title).toBe('ok');
      });
    } finally {
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      stderrSpy.mockRestore();
    }
    expect(output).toContain('claves sin efecto');
  });

  it('no emite warnings para una configuración válida', async () => {
    const stderrSpy = spyOn(process.stderr, 'write');
    let callCount = 0;
    try {
      await withTempDir(async (dir) => {
        await writeConfig(dir, 'format:\n  html:\n    title: ok\n  pdf:\n    generate: true');
        await loadSiteConfig(dir);
      });
    } finally {
      callCount = stderrSpy.mock.calls.length;
      stderrSpy.mockRestore();
    }
    expect(callCount).toBe(0);
  });

  // ── Tests de las tres vías de carga (cubren la unificación de defaults) ──

  it('format.latex es false con config presente sin clave latex (vía 1)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'lang: es-MX');
      const config = await loadSiteConfig(dir);
      expect(config.format.latex).toBe(false);
    });
  });

  it('format.html.generate es true con format: {} (vía 2)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format: {}');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.generate).toBe(true);
    });
  });

  it('disabled-preamble-filters tiene los 3 defaults con config presente sin la clave (vía 3)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'lang: es-MX\nformat:\n  html:\n    title: ok');
      const config = await loadSiteConfig(dir);
      expect(config.format?.pdf?.disabledPreambleFilters).toEqual(['24-eso-pic', '25-pdfx', '26-crop']);
    });
  });

  it('parsea la bibliografía y el CSL configurados a nivel raíz', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'lang: es-MX\nbibliography: refs/mi-libro.bib\ncsl: styles/nature.csl');
      const config = await loadSiteConfig(dir);
      expect(config.bibliography).toBe('refs/mi-libro.bib');
      expect(config.csl).toBe('styles/nature.csl');
    });
  });

  it('parsea format.html.blocks con override individual', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    blocks:\n      formatos: 4');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.blocks).toEqual({ formatos: 4 });
    });
  });

  it('adviierte sobre claves desconocidas en format.html.blocks', async () => {
    await withTempDir(async (dir) => {
      const writeSpy = spyOn(process.stderr, 'write');
      let output = '';
      try {
        await writeConfig(dir, 'format:\n  html:\n    blocks:\n      tarjeta-rara: 1');
        await loadSiteConfig(dir);
        output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      } finally {
        writeSpy.mockRestore();
      }
      expect(output).toContain('claves sin efecto');
      expect(output).toContain('tarjeta-rara');
    });
  });

  it('las tres vías de carga producen los mismos defaults de formato', async () => {
    let defaultsSinArchivo: SiteConfig = null!;
    let defaultsConArchivoVacio: SiteConfig = null!;
    let defaultsConMinimo: SiteConfig = null!;

    await withTempDir(async (dir) => {
      defaultsSinArchivo = await loadSiteConfig(dir);
    });
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      defaultsConArchivoVacio = await loadSiteConfig(dir);
    });
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'lang: es-MX');
      defaultsConMinimo = await loadSiteConfig(dir);
    });

    // Los defaults de formato deben coincidir en las tres vías
    expect(defaultsConArchivoVacio.format.latex).toBe(defaultsSinArchivo.format.latex);
    expect(defaultsConMinimo.format.latex).toBe(defaultsSinArchivo.format.latex);
    expect(defaultsConArchivoVacio.format.html?.generate).toBe(defaultsSinArchivo.format.html?.generate);
    expect(defaultsConMinimo.format.html?.generate).toBe(defaultsSinArchivo.format.html?.generate);
    expect(defaultsConArchivoVacio.format?.pdf?.disabledPreambleFilters).toEqual(defaultsSinArchivo.format?.pdf?.disabledPreambleFilters);
    expect(defaultsConMinimo.format?.pdf?.disabledPreambleFilters).toEqual(defaultsSinArchivo.format?.pdf?.disabledPreambleFilters);
  });

  it('los defaults del esquema coinciden con las constantes DEFAULT_* (fuente única)', async () => {
    await withTempDir(async (dir) => {
      const config = await loadSiteConfig(dir);
      expect(config.lang).toBe(DEFAULT_SITE_CONFIG.lang);
      expect(config.toc).toBe(DEFAULT_SITE_CONFIG.toc);
      expect(config.format.latex).toBe(DEFAULT_SITE_CONFIG.format.latex);
      expect(config.format.html).toEqual(DEFAULT_HTML_FORMAT);
      expect(config.format.pdf).toEqual(DEFAULT_PDF_FORMAT);
      expect(config.format.epub).toEqual(DEFAULT_EPUB_FORMAT);
      expect(config.format.markdown).toEqual(DEFAULT_MARKDOWN_FORMAT);
    });
  });

  it('el tema por defecto es dark sin config y con config sin la clave', async () => {
    await withTempDir(async (dir) => {
      expect((await loadSiteConfig(dir)).format.html?.theme).toBe('dark');
    });
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    title: ok');
      expect((await loadSiteConfig(dir)).format.html?.theme).toBe('dark');
    });
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    theme: light');
      expect((await loadSiteConfig(dir)).format.html?.theme).toBe('light');
    });
  });
});
