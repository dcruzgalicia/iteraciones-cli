import { describe, expect, it, spyOn } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSiteConfig, loadSiteConfigIfPresent, loadSiteConfigWithPresence } from '../config/config-loader.js';
import type { SiteConfig } from '../config/config-schema.js';
import type { HtmlFormatConfig } from '../config/site-config.js';
import { DEFAULT_EPUB_FORMAT, DEFAULT_HTML_FORMAT, DEFAULT_MARKDOWN_FORMAT, DEFAULT_PDF_FORMAT, DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import { ConfigError } from '../lib/errors.js';
import { withTempDir } from './helpers.js';

async function writeConfig(dir: string, content: string): Promise<void> {
  await writeFile(join(dir, 'iteraciones.config.yaml'), content, 'utf8');
}

describe('loadSiteConfig', () => {
  it('lanza ConfigError cuando no existe iteraciones.config.yaml (fail-fast, #2071)', async () => {
    await withTempDir(async (dir) => {
      const err: unknown = await loadSiteConfig(dir).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ConfigError);
      const message = err instanceof ConfigError ? err.message : '';
      expect(message).toContain("ejecuta 'iteraciones init'");
      expect(message).toContain('un archivo vacío usa los valores por defecto');
    });
  });

  it('retorna defaults cuando el archivo está vacío', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.site?.title).toBe('iteraciones');
    });
  });

  it('retorna defaults cuando el YAML no es un objeto', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'solo-un-string');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.site?.title).toBe('iteraciones');
    });
  });

  it('lanza ConfigError cuando el YAML tiene sintaxis inválida', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format: [mal formado');
      await expect(loadSiteConfig(dir)).rejects.toThrow(ConfigError);
    });
  });

  it('traduce las causas YAML conocidas al español (indentación inconsistente)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html: true\n latex:\n  generate: true\n');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/los items del mapeo deben empezar en la misma columna/);
    });
  });

  it('traduce las causas YAML conocidas al español (claves duplicadas)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'language: es-MX\nlanguage: es-MX\n');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/las claves del mapeo deben ser únicas/);
    });
  });

  it('traduce las causas YAML conocidas al español (secuencia de flujo sin cerrar)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'disabledFilters: [01-dictum\n');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/la secuencia de flujo debe estar bien indentada y terminar con ]/);
    });
  });

  it('reporta TODOS los errores de tipo en una sola ejecución (no solo el primero)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'language: 123\nformat:\n  html:\n    site:\n      theme: raro\n  pdf:\n    pageNumber: medio\n');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/language: .*format\.html\.site\.theme: .*format\.pdf\.pageNumber:/s);
    });
  });

  it('una config con forma de escalar se ignora con warning explícito', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'hola mundo');
      const stderrSpy = spyOn(process.stderr, 'write');
      let output = '';
      try {
        const config = await loadSiteConfig(dir);
        expect(config.language).toBe('es-MX'); // defaults
      } finally {
        output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        stderrSpy.mockRestore();
      }
      expect(output).toContain('no es un objeto YAML');
    });
  });

  it('lee format.html.site.title correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    site:\n      title: Mi Título');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.site?.title).toBe('Mi Título');
    });
  });

  it('lee format.html.site.description correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    site:\n      description: mi frase');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.site?.description).toBe('mi frase');
    });
  });

  it('lee language correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'language: en-US');
      const config = await loadSiteConfig(dir);
      expect(config.language).toBe('en-US');
    });
  });

  it('lee format.html.site.logo correctamente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    site:\n      logo: assets/logo.svg');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.site?.logo).toBe('assets/logo.svg');
    });
  });

  it('lee disabled-filters', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'disabledFilters:\n  - semantic/string/01-double-colon\n  - latex/02-dictum');
      const config = await loadSiteConfig(dir);
      expect(config.disabledFilters).toEqual(['semantic/string/01-double-colon', 'latex/02-dictum']);
    });
  });

  it('ignora disabled-filters vacío', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'disabledFilters: []');
      const config = await loadSiteConfig(dir);
      expect(config.disabledFilters).toBeUndefined();
    });
  });

  it('lee disabled-preamble-filters', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  pdf:\n    disabledPreambleFilters:\n      - 19-maketitle');
      const config = await loadSiteConfig(dir);
      expect(config.format?.pdf?.disabledPreambleFilters).toEqual(['19-maketitle']);
    });
  });

  it('lee lua-filters', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'luaFilters:\n  - filters/mi-filtro.lua');
      const config = await loadSiteConfig(dir);
      expect(config.luaFilters).toEqual(['filters/mi-filtro.lua']);
    });
  });

  it('activa format.latex con generate: true', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  latex:\n    generate: true');
      const config = await loadSiteConfig(dir);
      expect(config.format.latex?.generate).toBe(true);
    });
  });

  it('desactiva format.latex con generate: false', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  latex:\n    generate: false');
      const config = await loadSiteConfig(dir);
      expect(config.format.latex?.generate).toBe(false);
    });
  });

  it('el formato booleano antiguo latex: true es un error de tipo (sin fallback)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  latex: true');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/latex/);
    });
  });

  it('activa format.html con generate: true', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    generate: true\n    site:\n      theme: light\n      color: blue');
      const config = await loadSiteConfig(dir);
      expect(config.format.html?.generate).toBe(true);
      expect(config.format.html?.site?.theme).toBe('light');
      expect(config.format.html?.site?.color).toBe('blue');
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

  it('parsea format.pdf con generate:true y deja los campos PDF específicos sin materializar (resolución efectiva en consumidores)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  pdf:\n    generate: true');
      const config = await loadSiteConfig(dir);
      expect(config.format.pdf?.generate).toBe(true);
      expect(config.toc).toBe(false);
      expect(config.format.pdf?.showDate).toBeUndefined();
    });
  });

  it('un color de acento inválido es un error en build (sin fallback a lime)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    site:\n      color: color-inventado');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/accent|valor no válido/);
    });
  });

  it('claves desconocidas en format.pdf son un error (contrato build/validate)', async () => {
    await withTempDir(async (dir) => {
      // mathptmx es la clave de la documentación antigua; ya no existe en el esquema
      await writeConfig(dir, 'format:\n  pdf:\n    mathptmx: true\n    generate: true');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/claves desconocidas.*format\.pdf.*mathptmx/s);
    });
  });

  it('claves desconocidas en la raíz son un error (contrato build/validate)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'clave-inventada: 1\nformat:\n  html:\n    site:\n      title: ok');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/claves desconocidas.*clave-inventada/s);
    });
  });

  it('no emite warnings para una configuración válida', async () => {
    const stderrSpy = spyOn(process.stderr, 'write');
    let callCount = 0;
    try {
      await withTempDir(async (dir) => {
        await writeConfig(dir, 'format:\n  html:\n    site:\n      title: ok\n  pdf:\n    generate: true');
        await loadSiteConfig(dir);
      });
    } finally {
      callCount = stderrSpy.mock.calls.length;
      stderrSpy.mockRestore();
    }
    expect(callCount).toBe(0);
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

  it('disabled-preamble-filters queda sin materializar con config presente sin la clave (se resuelve en consumidores)', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'language: es-MX\nformat:\n  html:\n    site:\n      title: ok');
      const config = await loadSiteConfig(dir);
      expect(config.format?.pdf?.disabledPreambleFilters).toBeUndefined();
    });
  });

  it('parsea la bibliografía y el CSL configurados a nivel raíz', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'language: es-MX\nbibliography: refs/mi-libro.bib\ncsl: styles/nature.csl');
      const config = await loadSiteConfig(dir);
      expect(config.bibliography).toBe('refs/mi-libro.bib');
      expect(config.csl).toBe('styles/nature.csl');
    });
  });

  it('parsea format.html.blocks como lista ordenada', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    blocks:\n      - header\n      - indice\n      - contenido');
      const config = await loadSiteConfig(dir);
      expect((config.format.html as HtmlFormatConfig)?.blocks).toEqual(['header', 'indice', 'contenido']);
    });
  });

  it('un nombre de bloque desconocido en format.html.blocks es un error accionable', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    blocks:\n      - tarjeta-rara');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/no es un bloque conocido/);
    });
  });

  it('la sintaxis antigua de format.html.blocks (objeto con números) es un error accionable', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  html:\n    blocks:\n      formatos: 4');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/debe ser una lista de bloques/);
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

describe('loadSiteConfigIfPresent', () => {
  it('retorna null cuando no existe iteraciones.config.yaml', async () => {
    await withTempDir(async (dir) => {
      expect(await loadSiteConfigIfPresent(dir)).toBeNull();
    });
  });

  it('carga defaults cuando el archivo existe pero está vacío', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      const loaded = await loadSiteConfigIfPresent(dir);
      expect(loaded).not.toBeNull();
      expect(loaded?.config.language).toBe('es-MX');
      expect(loaded?.presentKeys.size).toBe(0);
    });
  });

  it('propaga errores de validación aunque el archivo exista', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'clave-inventada: 1\n');
      await expect(loadSiteConfigIfPresent(dir)).rejects.toThrow(ConfigError);
    });
  });
});

describe('loadSiteConfigWithPresence', () => {
  it('la clave escrita con valor idéntico al default se distingue de la ausente', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'format:\n  pdf:\n    disabledPreambleFilters:\n      - 97-eso-pic\n');
      const { config, presentKeys } = await loadSiteConfigWithPresence(dir);
      // La clave aparece como presente aunque su valor coincida con un default
      // del paquete (el caso que la sustracción de doctor --info no distinguía).
      expect(presentKeys.has('format.pdf.disabledPreambleFilters')).toBe(true);
      expect(config.format?.pdf?.disabledPreambleFilters).toEqual(['97-eso-pic']);
    });
  });

  it('sin la clave, el conjunto de presencia no la incluye y el valor queda sin materializar', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'language: es-MX');
      const { config, presentKeys } = await loadSiteConfigWithPresence(dir);
      expect(presentKeys.has('format.pdf.disabledPreambleFilters')).toBe(false);
      expect(config.format?.pdf?.disabledPreambleFilters).toBeUndefined();
    });
  });

  it('recoge rutas punteadas de todos los niveles del YAML', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, 'language: en-US\nformat:\n  pdf:\n    generate: true\n    showDate: true\n');
      const { presentKeys } = await loadSiteConfigWithPresence(dir);
      expect(presentKeys.has('language')).toBe(true);
      expect(presentKeys.has('format')).toBe(true);
      expect(presentKeys.has('format.pdf')).toBe(true);
      expect(presentKeys.has('format.pdf.generate')).toBe(true);
      expect(presentKeys.has('format.pdf.showDate')).toBe(true);
      expect(presentKeys.has('format.pdf.disabledPreambleFilters')).toBe(false);
    });
  });

  it('sin archivo de config falla; con archivo vacío el conjunto de presencia está vacío (#2071)', async () => {
    await withTempDir(async (dir) => {
      await expect(loadSiteConfigWithPresence(dir)).rejects.toThrow(ConfigError);
    });
    await withTempDir(async (dir) => {
      await writeConfig(dir, '');
      const { config, presentKeys } = await loadSiteConfigWithPresence(dir);
      expect(presentKeys.size).toBe(0);
      expect(config.language).toBe('es-MX');
    });
  });
});

describe('guard schema↔uso de format.html.site (#2016)', () => {
  it('format.html.site.css ya no existe en el schema: configurarla es un error', async () => {
    await withTempDir(async (dir) => {
      // Opción fantasma eliminada (ningún módulo la consumía)
      await writeConfig(dir, 'format:\n  html:\n    site:\n      css: styles/custom.css\n    generate: true');
      await expect(loadSiteConfig(dir)).rejects.toThrow(/claves desconocidas.*site.*css/s);
    });
  });
});
