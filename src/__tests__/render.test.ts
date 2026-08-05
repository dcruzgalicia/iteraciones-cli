import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computePreambleFlags,
  hasCiteNodes,
  loadFilterGroups,
  resolveLuaFilters,
  resolveUserLuaFilters,
  suggestFilterName,
  validateDisabledFilters,
} from '../builder/render.js';
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { DEFAULT_SITE_CONFIG } from '../config/site-config.js';
import * as logger from '../lib/logger.js';

describe('computePreambleFlags (desde el AST)', () => {
  it('detecta hasTocEntries con nodos Header', () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'Para', c: [] },
        { t: 'Header', c: [1, ['', [], []], [{ t: 'Str', c: 'T' }]] },
      ],
    };
    expect(computePreambleFlags(ast).hasTocEntries).toBe(true);
  });

  it('retorna hasTocEntries false sin Headers', () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [{ t: 'Para', c: [] }] };
    expect(computePreambleFlags(ast).hasTocEntries).toBe(false);
  });

  it('primer bloque Header: skipNoIndent y skipParagraphSpace true', () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'Header', c: [1, ['', [], []], [{ t: 'Str', c: 'T' }]] },
        { t: 'Para', c: [] },
      ],
    };
    const flags = computePreambleFlags(ast);
    expect(flags.skipNoIndent).toBe(true);
    expect(flags.skipParagraphSpace).toBe(true);
  });

  it('primer bloque Para normal: skipNoIndent y skipParagraphSpace false', () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Texto' }] }] };
    const flags = computePreambleFlags(ast);
    expect(flags.skipNoIndent).toBe(false);
    expect(flags.skipParagraphSpace).toBe(false);
  });

  it('dictum (Div.dictum como primer bloque): skipNoIndent true, skipParagraphSpace false', () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'Div', c: [['', ['dictum'], []], [{ t: 'Para', c: [{ t: 'Str', c: 'Cita' }] }]] },
        { t: 'Para', c: [] },
      ],
    };
    const flags = computePreambleFlags(ast);
    expect(flags.skipNoIndent).toBe(true);
    expect(flags.skipParagraphSpace).toBe(false);
  });

  it('verse (Div.verse como primer bloque): skipNoIndent true', () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'Div', c: [['', ['verse'], []], [{ t: 'Para', c: [] }]] },
        { t: 'Para', c: [] },
      ],
    };
    const flags = computePreambleFlags(ast);
    expect(flags.skipNoIndent).toBe(true);
  });

  it('center (Div.center) no cuenta como dictum-start', () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'Div', c: [['', ['center'], []], [{ t: 'Para', c: [] }]] },
        { t: 'Para', c: [] },
      ],
    };
    expect(computePreambleFlags(ast).skipNoIndent).toBe(false);
  });

  it('spacer (Div.spacer) no cuenta como dictum-start', () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'Div', c: [['', ['spacer'], []], []] },
        { t: 'Para', c: [] },
      ],
    };
    expect(computePreambleFlags(ast).skipNoIndent).toBe(false);
  });

  it('maneja blocks que no es un array', () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: 'no-array' };
    const flags = computePreambleFlags(ast);
    expect(flags).toEqual({ hasTocEntries: false, skipNoIndent: false, skipParagraphSpace: false });
  });
});

describe('hasCiteNodes (detección de citas en el AST)', () => {
  it('retorna true si el AST contiene un nodo Cite', () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Para',
          c: [{ t: 'Cite', c: [[{ citationId: 'einstein', citationPrefix: [], citationSuffix: [] }], [{ t: 'Str', c: 'x' }]] }],
        },
      ],
    };
    expect(hasCiteNodes(ast)).toBe(true);
  });

  it('retorna false sin nodos Cite', () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Texto' }] }] };
    expect(hasCiteNodes(ast)).toBe(false);
  });

  it('retorna false para AST sin bloques', () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [] };
    expect(hasCiteNodes(ast)).toBe(false);
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

describe('resolveLuaFilters (sistema dual Fase 6)', () => {
  const PKG = join(import.meta.dir, '..', 'lib', 'resources', 'filters');
  const LATEX_PKG = ['01-spacer', '02-dictum', '03-verse', '04-center', '05-flushright', '06-mbox-sentence-end', '07-mbox-sentence-start'].map((n) =>
    join(PKG, 'latex', `${n}.lua`),
  );

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
          'latex/07-mbox-sentence-start',
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
    expect(f.resolvedNames.size).toBe(13);
    expect(f.resolvedNames.has('semantic/string/01-double-colon')).toBe(false);
  });
});

describe('loadFilterGroups (solo resolución de filtros Lua)', () => {
  it('resuelve los 7 filtros latex del paquete en orden', async () => {
    const groups = await loadFilterGroups(DEFAULT_SITE_CONFIG);
    expect(groups.latex).toHaveLength(7);
    expect(groups.latex[1]).toContain('02-dictum.lua');
  });

  it('el override .lua del proyecto reemplaza al del paquete', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      mkdirSync(join(cwd, 'filters', 'latex'), { recursive: true });
      writeFileSync(join(cwd, 'filters', 'latex', '02-dictum.lua'), '-- test\n');
      const groups = await loadFilterGroups(DEFAULT_SITE_CONFIG, undefined, cwd);
      expect(groups.latex).toHaveLength(7);
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

  it('advierte y omite rutas inexistentes', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      writeFileSync(join(cwd, 'iteraciones.config.yaml'), 'lua-filters:\n  - filters/no-existe.lua\n');
      const spy = spyOn(logger, 'logWarning');
      const config = await loadSiteConfig(cwd);
      const resolved = await resolveUserLuaFilters(cwd, config);
      expect(resolved).toEqual([]);
      expect(spy).toHaveBeenCalledWith('lua-filters: "filters/no-existe.lua" no encontrado en el proyecto', 'config');
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
