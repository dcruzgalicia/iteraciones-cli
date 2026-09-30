import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getBuiltinFilterNames,
  loadFilterGroups,
  resolveLuaFilters,
  resolveUserLuaFilters,
  suggestFilterName,
  validateDisabledFilters,
} from '../builder/filter-resolver.js';
import { composeHtmlTemplate } from '../builder/html-composer.js';
import { markdownToLatex } from '../builder/latex-composer.js';
import { getBuiltinPreambleFilterNames } from '../builder/preamble-loader.js';
import { htmlPageFromMarkdown } from '../builder/render.js';
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { DEFAULT_SITE_CONFIG, type HtmlBlockKey } from '../config/site-config.js';
import * as logger from '../lib/logger.js';
import { getPandocVersion } from '../lib/pandoc-runner.js';
import { registerSkip, SKIP_REASONS } from './helpers.js';

const pandocOk = await getPandocVersion().catch(() => null);
if (!pandocOk) registerSkip('render.test.ts', SKIP_REASONS.pandoc);

describe('extractReferencesBlock (sin marcador en el template)', () => {
  it.skipIf(!pandocOk)('sin el marcador de referencias, la bibliografía se descarta con warning visible', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-render-'));
    try {
      // Template efectivo SIN la tarjeta referencias (sin <!-- block:referencias -->)
      writeFileSync(join(cwd, 'tpl.html'), '<html><body>$body$</body></html>');
      writeFileSync(join(cwd, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n');
      writeFileSync(join(cwd, 'iteraciones.config.yaml'), '');
      const content = '---\ntitle: T\ncreator: [Autor]\ndate: 2026-01-01\n---\n\nCita [@key1].\n';
      const doc: BuildDocument = {
        filePath: join(cwd, 'test.md'),
        relativePath: 'test.md',
        frontmatter: { title: 'T', date: '2026-01-01', creator: ['Autor'] },
      };
      const siteConfig = await loadSiteConfig(cwd);
      const warnSpy = spyOn(logger, 'logWarning');
      try {
        const html = await htmlPageFromMarkdown(content, doc, {
          cwd,
          vars: { title: 'T', siteTitle: 'test', lang: 'es-MX' },
          siteConfig,
          templatePath: join(cwd, 'tpl.html'),
          refsCardTemplate: '<div class="wrap"><h2 id="refs-heading">Referencias</h2>{{refs-list}}</div>',
          fm: {},
          bibOptions: { bibliography: join(cwd, 'bibliography.bib') },
          luaFilters: await loadFilterGroups(siteConfig, undefined, cwd),
        });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('la tarjeta de referencias no está en format.html.blocks'), 'html');
        // La bibliografía no se pierde en silencio: el warning lo hace visible
        expect(html).not.toContain('csl-entry');
      } finally {
        warnSpy.mockRestore();
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('pdfDate (fecha de portada del PDF)', () => {
  it.skipIf(!pandocOk)('con show-date y date en el frontmatter, la portada usa la fecha legible', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-render-'));
    try {
      const tpl = join(cwd, 'tpl.tex');
      writeFileSync(tpl, '\\date{$date$}\n$body$');
      writeFileSync(join(cwd, 'iteraciones.config.yaml'), '');
      const content = '---\ntitle: T\ndate: 2026-08-08\n---\n\nTexto.\n';
      const filePath = join(cwd, 'test.md');
      writeFileSync(filePath, content);
      const doc: BuildDocument = {
        filePath,
        relativePath: 'test.md',
        frontmatter: { title: 'T', date: '2026-08-08', creator: [] },
      };
      const siteConfig = await loadSiteConfig(cwd);
      const withShowDate = { ...siteConfig, format: { ...siteConfig.format, pdf: { ...siteConfig.format.pdf, showDate: true } } };
      const { tex } = await markdownToLatex(content, doc, {
        filters: await loadFilterGroups(withShowDate, undefined, cwd),
        bibFiles: [],
        templatePath: tpl,
        fm: { date: '2026-08-08' },
        siteConfig: withShowDate,
        formatCfg: withShowDate.format.pdf,
        warnedLangs: new Set(),
      });
      expect(tex).toContain('\\date{8 de agosto de 2026}');

      // Sin show-date, la fecha del frontmatter se neutraliza en la portada
      const sinShowDateResult = await markdownToLatex(content, doc, {
        filters: await loadFilterGroups(siteConfig, undefined, cwd),
        bibFiles: [],
        templatePath: tpl,
        fm: { date: '2026-08-08' },
        siteConfig,
        warnedLangs: new Set(),
      });
      expect(sinShowDateResult.tex).toContain('\\date{}');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('composeHtmlTemplate', () => {
  it('compone el template efectivo con los bloques en orden', async () => {
    const tpl = await composeHtmlTemplate(DEFAULT_SITE_CONFIG);
    const pos = (s: string): number => tpl.indexOf(s);
    // Contenido distintivo de cada tarjeta (sin marcadores internos)
    expect(pos('Tarjeta identidad')).toBeGreaterThan(-1); // header
    expect(pos('Tarjeta documento')).toBeGreaterThan(pos('Tarjeta identidad')); // contenido
    expect(pos('$if(formats)$')).toBeGreaterThan(pos('Tarjeta documento')); // formatos (marca de flag)
    expect(pos('$if(toc)$')).toBeGreaterThan(pos('$if(formats)$')); // indice
    expect(pos('$if(has-references)$')).toBeGreaterThan(pos('$if(toc)$')); // referencias
    expect(tpl.lastIndexOf('$if(home-href)$')).toBeGreaterThan(pos('$if(has-references)$')); // footer
  });

  it('el marcador de referencias es condicional (solo si el filtro detecta citas)', async () => {
    const tpl = await composeHtmlTemplate(DEFAULT_SITE_CONFIG);
    expect(tpl).toContain('$if(has-references)$');
    expect(tpl).toContain('<!-- block:referencias -->');
  });

  it('la tarjeta formatos vive en la plantilla: un flag y un $if$ por formato', async () => {
    const tpl = await composeHtmlTemplate(DEFAULT_SITE_CONFIG);
    expect(tpl).toContain('$if(formats)$');
    // icono, nombre y descripción horneados; el argv solo aporta el href
    expect(tpl).toContain('$fmt-pdf$');
    expect(tpl).toContain('$fmt-epub$');
    expect(tpl).not.toContain('$formats$');
  });

  it('respeta overrides de format.html.blocks', async () => {
    const siteConfig = {
      ...DEFAULT_SITE_CONFIG,
      format: {
        ...DEFAULT_SITE_CONFIG.format,
        html: { ...DEFAULT_SITE_CONFIG.format.html, blocks: ['header', 'indice', 'contenido', 'formatos'] as HtmlBlockKey[] },
      },
    };
    const tpl = await composeHtmlTemplate(siteConfig);
    expect(tpl.indexOf('$if(formats)$')).toBeGreaterThan(tpl.indexOf('$if(toc)$'));
  });

  it('en una collection el body sale fuera de la tarjeta de contenido (#2483)', async () => {
    const tpl = await composeHtmlTemplate(DEFAULT_SITE_CONFIG);
    const rama = tpl.split('$if(collection)$')[1]?.split('$else$') ?? ['', ''];
    // su data card y las de cada file son tarjetas del masonry, no del article
    expect(rama[0]).toContain('$body$');
    expect(rama[0], 'la rama de collection no trae la tarjeta de contenido').not.toContain('<article');
    expect(rama[1], 'el resto de documentos sigue con su article').toContain('<article');
  });

  it('el header y el footer van fuera del masonry, en una columna centrada (#2487)', async () => {
    const tpl = await composeHtmlTemplate(DEFAULT_SITE_CONFIG);
    const masonry = tpl.slice(tpl.indexOf('<main'), tpl.indexOf('</main>'));
    expect(masonry, 'ni el header ni el footer son columnas del masonry').not.toContain('Tarjeta identidad');
    expect(tpl.indexOf('Tarjeta identidad (enlaza'), 'el header va antes').toBeLessThan(tpl.indexOf('<main'));
    expect(tpl.indexOf('Tarjeta identidad final'), 'el footer va después').toBeGreaterThan(tpl.indexOf('</main>'));
    // una columna del masonry de ancho, centrada: la mitad con 2, un tercio con 3,
    // con aire alrededor de la tarjeta (no dentro)
    expect(tpl).toContain('<div class="mx-auto w-full px-6 sm:px-8 md:w-1/2 2xl:w-1/3">');
    expect(tpl.indexOf('mx-auto w-full')).toBeLessThan(tpl.indexOf('<main'));
  });

  it('reordenar blocks no mueve el header ni el footer (#2487)', async () => {
    const siteConfig = {
      ...DEFAULT_SITE_CONFIG,
      format: {
        ...DEFAULT_SITE_CONFIG.format,
        html: { ...DEFAULT_SITE_CONFIG.format.html, blocks: ['contenido', 'footer', 'header', 'indice'] as HtmlBlockKey[] },
      },
    };
    const tpl = await composeHtmlTemplate(siteConfig);
    const masonry = tpl.slice(tpl.indexOf('<main'), tpl.indexOf('</main>'));
    expect(masonry).not.toContain('Tarjeta identidad');
    expect(masonry, 'el contenido sí sigue en el masonry, en su orden').toContain('Tarjeta documento');
  });
});

describe('memoización de nombres (un escaneo por proceso)', () => {
  it('getBuiltinFilterNames devuelve la misma referencia en llamadas sucesivas', () => {
    const a = getBuiltinFilterNames();
    const b = getBuiltinFilterNames();
    expect(a).toBe(b); // misma referencia → escaneo único del filesystem
    expect(a.length).toBeGreaterThan(0);
  });

  it('getBuiltinPreambleFilterNames devuelve la misma referencia en llamadas sucesivas', () => {
    const a = getBuiltinPreambleFilterNames();
    const b = getBuiltinPreambleFilterNames();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('suggestFilterName', () => {
  it('sugiere el nombre completo por sufijo', () => {
    expect(suggestFilterName('02-dictum')).toBe('latex/02-dictum');
    expect(suggestFilterName('01-dictum')).toBe('html/01-dictum');
    expect(suggestFilterName('05-spacer')).toBe('html/05-spacer');
  });

  it('retorna undefined sin coincidencia', () => {
    expect(suggestFilterName('no-existe')).toBeUndefined();
    expect(suggestFilterName('spacer')).toBeUndefined();
  });
});

describe('validateDisabledFilters', () => {
  it('no advierte con undefined o lista vacía', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledFilters(undefined);
    validateDisabledFilters([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('no advierte con nombres completos válidos', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledFilters(['latex/02-dictum', 'semantic/string/01-double-colon']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('advierte con sugerencia para un nombre viejo (pre-D1)', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledFilters(['02-dictum']);
    expect(spy).toHaveBeenCalledWith('disabledFilters: "02-dictum" no existe; ¿quisiste decir "latex/02-dictum"?', 'config');
    spy.mockRestore();
  });

  it('advierte sin sugerencia para un nombre inexistente', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledFilters(['foo/bar']);
    expect(spy).toHaveBeenCalledWith('disabledFilters: "foo/bar" no coincide con ningún filter', 'config');
    spy.mockRestore();
  });
});

describe('resolveLuaFilters (resolución de filtros)', () => {
  const PKG = join(import.meta.dir, '..', 'lib', 'resources', 'filters');
  const LATEX_PKG = [
    '01-spacer',
    '02-dictum',
    '03-verse',
    '04-center',
    '05-flushright',
    '06-mbox-sentence-end',
    '07-titlepages',
    '08-textsize',
    '09-quote-noindent',
    '10-cjk',
    '11-uppercase',
    '12-mbox',
    '13-spacing',
    '14-textls',
  ].map((n) => join(PKG, 'latex', `${n}.lua`));

  it('resuelve los filtros del paquete por capa sin overrides', async () => {
    const f = await resolveLuaFilters();
    expect(f.semantic).toEqual([
      join(PKG, 'semantic', 'string', '01-double-colon.lua'),
      join(PKG, 'semantic', 'ast', '02-double-colon-noindent.lua'),
      join(PKG, 'semantic', 'ast', '03-qr-url.lua'),
      join(PKG, 'semantic', 'ast', '04-image-paths.lua'),
    ]);
    expect(f.latex).toEqual(LATEX_PKG);
    expect(f.html).toEqual(
      ['01-dictum', '02-verse', '03-center', '04-flushright', '05-spacer', '06-subparagraph'].map((n) => join(PKG, 'html', `${n}.lua`)),
    );
  });

  it('el override del proyecto gana sobre el paquete para el mismo nombre', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      mkdirSync(join(cwd, 'filters', 'semantic', 'ast'), { recursive: true });
      mkdirSync(join(cwd, 'filters', 'latex'), { recursive: true });
      writeFileSync(join(cwd, 'filters', 'semantic', 'ast', '02-double-colon-noindent.lua'), '-- test\n');
      writeFileSync(join(cwd, 'filters', 'latex', '02-dictum.lua'), '-- test\n');
      const f = await resolveLuaFilters(undefined, cwd);
      expect(f.semantic).toEqual([
        join(PKG, 'semantic', 'string', '01-double-colon.lua'),
        join(cwd, 'filters', 'semantic', 'ast', '02-double-colon-noindent.lua'),
        join(PKG, 'semantic', 'ast', '03-qr-url.lua'),
        join(PKG, 'semantic', 'ast', '04-image-paths.lua'),
      ]);
      const expectedLatex = [...LATEX_PKG];
      expectedLatex[1] = join(cwd, 'filters', 'latex', '02-dictum.lua');
      expect(f.latex).toEqual(expectedLatex);
      expect(f.html).toEqual(
        ['01-dictum', '02-verse', '03-center', '04-flushright', '05-spacer', '06-subparagraph'].map((n) => join(PKG, 'html', `${n}.lua`)),
      );
      expect(f.resolvedNames).toEqual(
        new Set([
          'semantic/string/01-double-colon',
          'semantic/ast/02-double-colon-noindent',
          'semantic/ast/03-qr-url',
          'semantic/ast/04-image-paths',
          'latex/01-spacer',
          'latex/02-dictum',
          'latex/03-verse',
          'latex/04-center',
          'latex/05-flushright',
          'latex/06-mbox-sentence-end',
          'latex/07-titlepages',
          'latex/08-textsize',
          'latex/09-quote-noindent',
          'latex/10-cjk',
          'latex/11-uppercase',
          'latex/12-mbox',
          'latex/13-spacing',
          'latex/14-textls',
          'html/01-dictum',
          'html/02-verse',
          'html/03-center',
          'html/04-flushright',
          'html/05-spacer',
          'html/06-subparagraph',
        ]),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('excluye filtros desactivados por nombre completo', async () => {
    const f = await resolveLuaFilters(['semantic/string/01-double-colon']);
    expect(f.semantic).toEqual([
      join(PKG, 'semantic', 'ast', '02-double-colon-noindent.lua'),
      join(PKG, 'semantic', 'ast', '03-qr-url.lua'),
      join(PKG, 'semantic', 'ast', '04-image-paths.lua'),
    ]);
    expect(f.resolvedNames.size).toBe(23);
    expect(f.resolvedNames.has('semantic/string/01-double-colon')).toBe(false);
  });
});

describe('loadFilterGroups (solo resolución de filtros Lua)', () => {
  it('resuelve los filtros latex del paquete en orden (derivado del filesystem)', async () => {
    const groups = await loadFilterGroups(DEFAULT_SITE_CONFIG);
    const latexCount = getBuiltinFilterNames().filter((n) => n.startsWith('latex/')).length;
    expect(latexCount).toBeGreaterThan(0);
    expect(groups.latex).toHaveLength(latexCount);
    expect(groups.latex[1]).toContain('02-dictum.lua');
  });

  it('incluye el filtro interno de flags (no expuesto a disabled-filters)', async () => {
    const groups = await loadFilterGroups(DEFAULT_SITE_CONFIG);
    expect(groups.flags).toHaveLength(1);
    expect(groups.flags[0]).toContain('internal');
    expect(groups.flags[0]).toContain('flags.lua');
    expect(getBuiltinFilterNames().some((n) => n.startsWith('internal/'))).toBe(false);
  });

  it('el override .lua del proyecto reemplaza al del paquete', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      mkdirSync(join(cwd, 'filters', 'latex'), { recursive: true });
      writeFileSync(join(cwd, 'filters', 'latex', '02-dictum.lua'), '-- test\n');
      const groups = await loadFilterGroups(DEFAULT_SITE_CONFIG, undefined, cwd);
      const latexCount = getBuiltinFilterNames().filter((n) => n.startsWith('latex/')).length;
      expect(groups.latex).toHaveLength(latexCount);
      expect(groups.latex[1]).toBe(join(cwd, 'filters', 'latex', '02-dictum.lua'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('resolveUserLuaFilters (lua-filters de usuario)', () => {
  it('resuelve rutas relativas del proyecto a absolutas', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      mkdirSync(join(cwd, 'filters'), { recursive: true });
      writeFileSync(join(cwd, 'filters', 'mi-filtro.lua'), '-- test\n');
      writeFileSync(join(cwd, 'iteraciones.config.yaml'), 'luaFilters:\n  - filters/mi-filtro.lua\n');
      const config = await loadSiteConfig(cwd);
      const resolved = await resolveUserLuaFilters(cwd, config);
      expect(resolved).toEqual([join(cwd, 'filters', 'mi-filtro.lua')]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('omite rutas inexistentes sin advertir (el warning lo emite validateConfigFilePaths)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      writeFileSync(join(cwd, 'iteraciones.config.yaml'), 'luaFilters:\n  - filters/no-existe.lua\n');
      const spy = spyOn(logger, 'logWarning');
      const config = await loadSiteConfig(cwd);
      const resolved = await resolveUserLuaFilters(cwd, config);
      expect(resolved).toEqual([]);
      // Fuente única de reporte (#2011): el resolver solo omite, no emite
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('retorna vacío sin lua-filters', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      expect(await resolveUserLuaFilters(cwd, DEFAULT_SITE_CONFIG)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
