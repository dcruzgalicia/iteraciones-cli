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
import { composeHtmlTemplate, resolveBlockOrder } from '../builder/html-composer.js';
import { markdownToLatex } from '../builder/latex-composer.js';
import { getBuiltinPreambleFilterNames } from '../builder/preamble-loader.js';
import { htmlPageFromMarkdown } from '../builder/render.js';
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { DEFAULT_SITE_CONFIG, type HtmlBlockKey } from '../config/site-config.js';
import * as logger from '../lib/logger.js';
import { checkPandoc } from '../lib/pandoc-runner.js';

const pandocOk = await checkPandoc().catch(() => null);

describe('extractReferencesBlock (sin marcador en el template)', () => {
  it.skipIf(!pandocOk)('sin el marcador de referencias, la bibliografía se descarta con warning visible', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-render-'));
    try {
      // Template efectivo SIN la tarjeta referencias (sin <!-- block:referencias -->)
      writeFileSync(join(cwd, 'tpl.html'), '<html><body>$body$</body></html>');
      writeFileSync(join(cwd, 'bibliography.bib'), '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n');
      const content = '---\ntitle: T\ncreator: [Autor]\ndate: 2026-01-01\n---\n\nCita [@key1].\n';
      const doc: BuildDocument = {
        filePath: join(cwd, 'test.md'),
        relativePath: 'test.md',
        frontmatter: { title: 'T', date: '2026-01-01', creator: ['Autor'] },
      };
      const siteConfig = await loadSiteConfig(cwd);
      const warnSpy = spyOn(logger, 'logWarning');
      try {
        const html = await htmlPageFromMarkdown(
          content,
          doc,
          cwd,
          { title: 'T', siteTitle: 'test', lang: 'es-MX' },
          siteConfig,
          join(cwd, 'tpl.html'),
          '<div class="wrap"><h2 id="refs-heading">Referencias</h2>{{refs-list}}</div>',
          {},
          { bibliography: join(cwd, 'bibliography.bib') },
          await loadFilterGroups(siteConfig, undefined, cwd),
        );
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
      const { tex } = await markdownToLatex(
        content,
        doc,
        await loadFilterGroups(withShowDate, undefined, cwd),
        [],
        tpl,
        { date: '2026-08-08' },
        withShowDate,
        true,
        new Set(),
      );
      expect(tex).toContain('\\date{8 de agosto de 2026}');

      // Sin show-date, la fecha del frontmatter se neutraliza en la portada
      const sinShowDateResult = await markdownToLatex(
        content,
        doc,
        await loadFilterGroups(siteConfig, undefined, cwd),
        [],
        tpl,
        { date: '2026-08-08' },
        siteConfig,
        true,
        new Set(),
      );
      expect(sinShowDateResult.tex).toContain('\\date{}');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('resolveBlockOrder', () => {
  it('sin lista explícita usa el orden por defecto', () => {
    expect(resolveBlockOrder()).toEqual(['header', 'contenido', 'formatos', 'indice', 'referencias', 'footer']);
  });

  it('una lista explícita ES el orden (reordenar y omitir bloques)', () => {
    expect(resolveBlockOrder(['header', 'contenido', 'indice', 'formatos'])).toEqual(['header', 'contenido', 'indice', 'formatos']);
    expect(resolveBlockOrder(['footer', 'header'])).toEqual(['footer', 'header']);
  });
});

describe('composeHtmlTemplate', () => {
  it('compone el template efectivo con los bloques en orden', async () => {
    const tpl = await composeHtmlTemplate(DEFAULT_SITE_CONFIG);
    const pos = (s: string): number => tpl.indexOf(s);
    // Contenido distintivo de cada tarjeta (sin marcadores internos)
    expect(pos('Tarjeta identidad')).toBeGreaterThan(-1); // header
    expect(pos('Tarjeta documento')).toBeGreaterThan(pos('Tarjeta identidad')); // contenido
    expect(pos('$formats$')).toBeGreaterThan(pos('Tarjeta documento')); // formatos (variable)
    expect(pos('$if(toc)$')).toBeGreaterThan(pos('$formats$')); // indice
    expect(pos('$if(has-references)$')).toBeGreaterThan(pos('$if(toc)$')); // referencias
    expect(tpl.lastIndexOf('$if(home-href)$')).toBeGreaterThan(pos('$if(has-references)$')); // footer
  });

  it('el marcador de referencias es condicional (solo si el filtro detecta citas)', async () => {
    const tpl = await composeHtmlTemplate(DEFAULT_SITE_CONFIG);
    expect(tpl).toContain('$if(has-references)$');
    expect(tpl).toContain('<!-- block:referencias -->');
  });

  it('la tarjeta formatos se inserta por variable de template', async () => {
    const tpl = await composeHtmlTemplate(DEFAULT_SITE_CONFIG);
    expect(tpl).toContain('$if(formats)$');
    expect(tpl).toContain('$formats$');
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
    expect(tpl.indexOf('$formats$')).toBeGreaterThan(tpl.indexOf('$if(toc)$'));
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
    expect(spy).toHaveBeenCalledWith('disabled-filters: "02-dictum" no existe; ¿quisiste decir "latex/02-dictum"?', 'config');
    spy.mockRestore();
  });

  it('advierte sin sugerencia para un nombre inexistente', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledFilters(['foo/bar']);
    expect(spy).toHaveBeenCalledWith('disabled-filters: "foo/bar" no coincide con ningún filter', 'config');
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
    '08-quote-noindent',
    '09-cjk',
    '10-titlepages',
    '11-uppercase',
    '12-mbox',
  ].map((n) => join(PKG, 'latex', `${n}.lua`));

  it('resuelve los filtros del paquete por capa sin overrides', async () => {
    const f = await resolveLuaFilters();
    expect(f.semantic).toEqual([
      join(PKG, 'semantic', 'string', '01-double-colon.lua'),
      join(PKG, 'semantic', 'ast', '02-double-colon-noindent.lua'),
    ]);
    expect(f.latex).toEqual(LATEX_PKG);
    expect(f.html).toEqual(['01-dictum', '02-verse', '03-center', '04-flushright', '05-spacer'].map((n) => join(PKG, 'html', `${n}.lua`)));
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
      ]);
      const expectedLatex = [...LATEX_PKG];
      expectedLatex[1] = join(cwd, 'filters', 'latex', '02-dictum.lua');
      expect(f.latex).toEqual(expectedLatex);
      expect(f.html).toEqual(['01-dictum', '02-verse', '03-center', '04-flushright', '05-spacer'].map((n) => join(PKG, 'html', `${n}.lua`)));
      expect(f.resolvedNames).toEqual(
        new Set([
          'semantic/string/01-double-colon',
          'semantic/ast/02-double-colon-noindent',
          'latex/01-spacer',
          'latex/02-dictum',
          'latex/03-verse',
          'latex/04-center',
          'latex/05-flushright',
          'latex/06-mbox-sentence-end',
          'latex/08-quote-noindent',
          'latex/09-cjk',
          'latex/10-titlepages',
          'latex/11-uppercase',
          'latex/12-mbox',
          'html/01-dictum',
          'html/02-verse',
          'html/03-center',
          'html/04-flushright',
          'html/05-spacer',
        ]),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('excluye filtros desactivados por nombre completo', async () => {
    const f = await resolveLuaFilters(['semantic/string/01-double-colon']);
    expect(f.semantic).toEqual([join(PKG, 'semantic', 'ast', '02-double-colon-noindent.lua')]);
    expect(f.resolvedNames.size).toBe(17);
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
      writeFileSync(join(cwd, 'iteraciones.config.yaml'), 'lua-filters:\n  - filters/mi-filtro.lua\n');
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
      writeFileSync(join(cwd, 'iteraciones.config.yaml'), 'lua-filters:\n  - filters/no-existe.lua\n');
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
