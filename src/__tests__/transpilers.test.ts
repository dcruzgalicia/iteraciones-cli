import { beforeAll, describe, expect, it } from 'bun:test';

// ─── 01-double-colon ───────────────────────────────────────────────────────

describe('01-double-colon (string transpiler)', () => {
  let mod: any;

  beforeAll(async () => {
    mod = await import('../builder/transpilers/01-double-colon.ts');
  });

  it('exporta type como "string"', () => {
    expect(mod.type).toBe('string');
  });

  it('exporta una función process', () => {
    expect(typeof mod.process).toBe('function');
  });

  it('convierte :: sola en una línea a \\vspace', () => {
    const result = mod.process('texto antes\n\n::\n\ntexto después');
    expect(result).toBe('texto antes\n\n\\vspace{\\baselineskip}\n\ntexto después');
  });

  it('convierte múltiples líneas ::', () => {
    const result = mod.process('a\n::\nb\n::\nc');
    expect(result).toBe('a\n\\vspace{\\baselineskip}\nb\n\\vspace{\\baselineskip}\nc');
  });

  it('no modifica :: cuando no está sola en la línea', () => {
    const result = mod.process(':: con texto');
    expect(result).toBe(':: con texto');
  });

  it('no modifica texto sin ::', () => {
    const result = mod.process('texto normal sin nada');
    expect(result).toBe('texto normal sin nada');
  });

  it('convierte tres líneas :: consecutivas', () => {
    const result = mod.process('::\n::\n::');
    expect(result).toBe('\\vspace{\\baselineskip}\n\\vspace{\\baselineskip}\n\\vspace{\\baselineskip}');
  });

  it('retorna string vacío sin cambios', () => {
    expect(mod.process('')).toBe('');
  });
});

// ─── 02-dictum ─────────────────────────────────────────────────────────────

describe('02-dictum (AST transpiler)', () => {
  let mod: any;

  beforeAll(async () => {
    mod = await import('../builder/transpilers/02-dictum.ts');
  });

  it('exporta type como "ast"', () => {
    expect(mod.type).toBe('ast');
  });

  it('exporta una función transform', () => {
    expect(typeof mod.transform).toBe('function');
  });

  it('retorna el AST sin cambios si no hay Div.dictum', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Hola' }] }],
    };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('retorna el AST sin cambios si blocks está vacío', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });
});

// ─── 03-verse ──────────────────────────────────────────────────────────────

describe('03-verse (AST transpiler)', () => {
  let mod: any;

  beforeAll(async () => {
    mod = await import('../builder/transpilers/03-verse.ts');
  });

  it('exporta type como "ast"', () => {
    expect(mod.type).toBe('ast');
  });

  it('exporta una función transform', () => {
    expect(typeof mod.transform).toBe('function');
  });

  it('retorna el AST sin cambios si no hay Div.verse', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Hola' }] }],
    };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('retorna el AST sin cambios si blocks está vacío', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });
});

// ─── 07-mbox-sentence-start ──────────────────────────────────────────────

describe('07-mbox-sentence-start (AST transpiler)', () => {
  let mod: any;

  beforeAll(async () => {
    mod = await import('../builder/transpilers/07-mbox-sentence-start.ts');
  });

  it('exporta type como "ast"', () => {
    expect(mod.type).toBe('ast');
  });

  it('exporta una función transform', () => {
    expect(typeof mod.transform).toBe('function');
  });

  it('retorna AST sin cambios si no hay bloques Para', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Header', c: [1, ['title', [], []], [{ t: 'Str', c: 'Título' }]] }],
    };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('retorna AST sin cambios si blocks está vacío', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('no modifica un párrafo con menos de 2 palabras', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Hola' }] }],
    };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('maneja blocks que no es un array', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: 'no-array' };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('maneja bloque Para sin c (inlines)', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [{ t: 'Para' }] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });
});

// ─── 08-mbox-sentence-end ────────────────────────────────────────────────

describe('08-mbox-sentence-end (AST transpiler)', () => {
  let mod: any;

  beforeAll(async () => {
    mod = await import('../builder/transpilers/08-mbox-sentence-end.ts');
  });

  it('exporta type como "ast"', () => {
    expect(mod.type).toBe('ast');
  });

  it('exporta una función transform', () => {
    expect(typeof mod.transform).toBe('function');
  });

  it('retorna AST sin cambios si no hay bloques Para', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Header', c: [1, ['title', [], []], [{ t: 'Str', c: 'Título' }]] }],
    };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('retorna AST sin cambios si blocks está vacío', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('no modifica un párrafo con menos de 4 palabras', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Hola' }, { t: 'Space' }, { t: 'Str', c: 'mundo' }] }],
    };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('maneja blocks que no es un array', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: 'no-array' };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });

  it('maneja bloque Para sin c (inlines)', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [{ t: 'Para' }] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast);
  });
});

// ─── _ast-utils ────────────────────────────────────────────────────────────

describe('_ast-utils (helpers compartidos)', () => {
  let utils: any;

  beforeAll(async () => {
    utils = await import('../builder/transpilers/_ast-utils.ts');
  });

  describe('hasClass', () => {
    it('retorna true si el bloque tiene la clase indicada', () => {
      const block = { t: 'Div', c: [['', ['dictum'], []], [{ t: 'Para', c: [] }]] };
      expect(utils.hasClass(block, 'dictum')).toBe(true);
    });

    it('retorna false si el bloque no tiene la clase', () => {
      const block = { t: 'Div', c: [['', ['verse'], []], [{ t: 'Para', c: [] }]] };
      expect(utils.hasClass(block, 'dictum')).toBe(false);
    });

    it('retorna false si c no es un array', () => {
      const block = { t: 'Div', c: 'no-array' };
      expect(utils.hasClass(block, 'dictum')).toBe(false);
    });

    it('retorna false si c tiene menos de 2 elementos', () => {
      const block = { t: 'Div', c: [['', ['dictum'], []]] };
      expect(utils.hasClass(block, 'dictum')).toBe(false);
    });

    it('retorna false si attrs no es array', () => {
      const block = { t: 'Div', c: ['no-array', []] };
      expect(utils.hasClass(block, 'dictum')).toBe(false);
    });
  });

  describe('blockContent', () => {
    it('retorna el contenido de un bloque Div', () => {
      const block = { t: 'Div', c: [['', ['dictum'], []], [{ t: 'Para', c: [] }]] };
      expect(utils.blockContent(block)).toEqual([{ t: 'Para', c: [] }]);
    });

    it('retorna array vacío si c no es un array', () => {
      const block = { t: 'Div', c: 'no-array' };
      expect(utils.blockContent(block)).toEqual([]);
    });

    it('retorna array vacío si c tiene menos de 2 elementos', () => {
      const block = { t: 'Div', c: [['', ['dictum'], []]] };
      expect(utils.blockContent(block)).toEqual([]);
    });
  });
});
