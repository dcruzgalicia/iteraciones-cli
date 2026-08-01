import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computePreambleFlags,
  hasCiteNodes,
  loadTranspilerGroups,
  renderFromAstCache,
  resolveLuaFilters,
  suggestTranspilerName,
  validateDisabledTranspilers,
} from '../builder/render.js';
import type { BuildDocument } from '../builder/types.js';
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

describe('renderFromAstCache (exportación desde AST en disco)', () => {
  it('retorna conjunto vacío si no hay AST serializado en disco', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-ast-'));
    try {
      const doc: BuildDocument = {
        filePath: join(cwd, 'doc.md'),
        relativePath: 'doc.md',
        frontmatter: { title: 'Prueba', date: '', author: [] },
        slug: 'prueba',
      };
      const processed = await renderFromAstCache([doc], 1, cwd);
      expect(processed.size).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('suggestTranspilerName', () => {
  it('sugiere el nombre completo por sufijo', () => {
    expect(suggestTranspilerName('02-dictum')).toBe('latex/02-dictum');
    expect(suggestTranspilerName('01-dictum')).toBe('html/01-dictum');
    expect(suggestTranspilerName('05-spacer')).toBe('html/05-spacer');
  });

  it('retorna undefined sin coincidencia', () => {
    expect(suggestTranspilerName('no-existe')).toBeUndefined();
    expect(suggestTranspilerName('spacer')).toBeUndefined();
  });
});

describe('validateDisabledTranspilers', () => {
  it('no advierte con undefined o lista vacía', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledTranspilers(undefined);
    validateDisabledTranspilers([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('no advierte con nombres completos válidos', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledTranspilers(['latex/02-dictum', 'semantic/string/01-double-colon']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('advierte con sugerencia para un nombre viejo (pre-D1)', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledTranspilers(['02-dictum']);
    expect(spy).toHaveBeenCalledWith('disabled-transpilers: "02-dictum" no existe; ¿quisiste decir "latex/02-dictum"?', 'config');
    spy.mockRestore();
  });

  it('advierte sin sugerencia para un nombre inexistente', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledTranspilers(['foo/bar']);
    expect(spy).toHaveBeenCalledWith('disabled-transpilers: "foo/bar" no coincide con ningún transpiler', 'config');
    spy.mockRestore();
  });
});

describe('resolveLuaFilters (sistema dual Fase 6)', () => {
  it('retorna vacío sin overrides del proyecto (el paquete aún no tiene .lua)', async () => {
    const f = await resolveLuaFilters();
    expect(f.semantic).toEqual([]);
    expect(f.latex).toEqual([]);
    expect(f.html).toEqual([]);
    expect(f.resolvedNames.size).toBe(0);
  });

  it('resuelve overrides del proyecto por capa y respeta el orden', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      mkdirSync(join(cwd, 'transpilers', 'semantic', 'ast'), { recursive: true });
      mkdirSync(join(cwd, 'transpilers', 'latex'), { recursive: true });
      writeFileSync(join(cwd, 'transpilers', 'semantic', 'ast', '02-double-colon-noindent.lua'), '-- test\n');
      writeFileSync(join(cwd, 'transpilers', 'latex', '02-dictum.lua'), '-- test\n');
      const f = await resolveLuaFilters(undefined, cwd);
      expect(f.semantic).toEqual([join(cwd, 'transpilers', 'semantic', 'ast', '02-double-colon-noindent.lua')]);
      expect(f.latex).toEqual([join(cwd, 'transpilers', 'latex', '02-dictum.lua')]);
      expect(f.html).toEqual([]);
      expect(f.resolvedNames).toEqual(new Set(['semantic/ast/02-double-colon-noindent', 'latex/02-dictum']));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('excluye filtros desactivados por nombre completo', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      mkdirSync(join(cwd, 'transpilers', 'latex'), { recursive: true });
      writeFileSync(join(cwd, 'transpilers', 'latex', '02-dictum.lua'), '-- test\n');
      const f = await resolveLuaFilters(['latex/02-dictum'], cwd);
      expect(f.latex).toEqual([]);
      expect(f.resolvedNames.size).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('loadTranspilerGroups (dual .lua > .ts)', () => {
  it('mantiene el transpiler TS cuando no existe su .lua', async () => {
    const groups = await loadTranspilerGroups();
    expect(groups.latex.map((t) => t.name)).toContain('02-dictum');
    expect(groups.luaFilters.latex).toEqual([]);
  });

  it('omite el transpiler TS cuando existe su .lua (override del proyecto)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-lua-'));
    try {
      mkdirSync(join(cwd, 'transpilers', 'latex'), { recursive: true });
      writeFileSync(join(cwd, 'transpilers', 'latex', '02-dictum.lua'), '-- test\n');
      const groups = await loadTranspilerGroups(undefined, cwd);
      expect(groups.latex.map((t) => t.name)).not.toContain('02-dictum');
      expect(groups.luaFilters.latex).toEqual([join(cwd, 'transpilers', 'latex', '02-dictum.lua')]);
      expect(groups.latex.map((t) => t.name)).toContain('01-spacer');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
