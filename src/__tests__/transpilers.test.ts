import { beforeAll, describe, expect, it } from 'bun:test';

// Tipos para los módulos de transpilers en tests (evita any explícito)
interface TestBlock {
  t?: string;
  c: unknown[];
}

interface TestAst {
  blocks: TestBlock[];
}

interface TranspilerTestModule {
  type: string;
  process: (body: string) => string;
  transform: (ast: Record<string, unknown>) => Promise<TestAst>;
}

interface AstUtilsModule {
  hasClass: (block: Record<string, unknown>, cls: string) => boolean;
  blockContent: (block: Record<string, unknown>) => unknown[];
  escapeLatex: (s: string) => string;
  inlinesToLatex: (inlines: unknown[]) => string;
}

/** Accede a un bloque del AST de prueba sin aserciones no nulas. */
function b(result: TestAst, index: number): TestBlock {
  const block = result.blocks[index];
  if (block === undefined) throw new Error(`Bloque ${index} no existe en el AST de prueba`);
  return block;
}

// ─── latex/01-spacer ───────────────────────────────────────────────────────

describe('latex/01-spacer (AST transpiler)', () => {
  let mod: TranspilerTestModule;

  beforeAll(async () => {
    mod = (await import('../builder/transpilers/latex/01-spacer.ts')) as unknown as TranspilerTestModule;
  });

  it('convierte Div.spacer a RawBlock vspace', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Div', c: [['', ['spacer'], []], []] }],
    };
    const result = await mod.transform(ast);
    expect(b(result, 0)).toEqual({ t: 'RawBlock', c: ['latex', '\\vspace{\\baselineskip}'] });
  });

  it('agrega \\noindent al parrafo siguiente despues de un spacer noindent', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'Div', c: [['', ['spacer', 'noindent'], []], []] },
        { t: 'Para', c: [{ t: 'Str', c: 'Texto siguiente' }] },
      ],
    };
    const result = await mod.transform(ast);
    expect(b(result, 0).t).toBe('RawBlock');
    expect(b(result, 1).t).toBe('Para');
    expect(b(result, 1).c[0]).toEqual({ t: 'RawInline', c: ['latex', '\\noindent '] });
    expect(b(result, 1).c[1]).toEqual({ t: 'Str', c: 'Texto siguiente' });
  });

  it('no agrega \\noindent si despues del spacer hay un bloque que no es Para', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'Div', c: [['', ['spacer', 'noindent'], []], []] },
        { t: 'Header', c: [1, ['title', [], []], [{ t: 'Str', c: 'Título' }]] },
      ],
    };
    const result = await mod.transform(ast);
    expect(b(result, 1).t).toBe('Header');
  });

  it('no agrega noindent para un spacer sin clase noindent', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        { t: 'Div', c: [['', ['spacer'], []], []] },
        { t: 'Para', c: [{ t: 'Str', c: 'Texto' }] },
      ],
    };
    const result = await mod.transform(ast);
    expect(b(result, 1).c[0]).toEqual({ t: 'Str', c: 'Texto' });
  });
});

// ─── 03-dictum ─────────────────────────────────────────────────────────────

describe('latex/02-dictum (AST transpiler)', () => {
  let mod: TranspilerTestModule;

  beforeAll(async () => {
    mod = (await import('../builder/transpilers/latex/02-dictum.ts')) as unknown as TranspilerTestModule;
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
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('retorna el AST sin cambios si blocks está vacío', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('convierte Div.dictum en RawInline de apertura/cierre pegados al parrafo', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Div',
          c: [['', ['dictum'], []], [{ t: 'Para', c: [{ t: 'Str', c: 'Cita de prueba' }] }]],
        },
      ],
    };
    const result = await mod.transform(ast);
    expect(result.blocks).toEqual([
      {
        t: 'Para',
        c: [
          { t: 'RawInline', c: ['latex', '\\vspace*{0.5\\topskip}\\dictum{'] },
          { t: 'Str', c: 'Cita de prueba' },
          { t: 'RawInline', c: ['latex', '}\\vspace*{32pt}'] },
        ],
      },
    ]);
  });

  it('usa beforeskip/afterskip de los atributos del fenced div', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Div',
          c: [
            [
              '',
              ['dictum'],
              [
                ['beforeskip', '1\\baselineskip'],
                ['afterskip', '24pt'],
              ],
            ],
            [{ t: 'Para', c: [{ t: 'Str', c: 'Cita' }] }],
          ],
        },
      ],
    };
    const result = await mod.transform(ast);
    expect(b(result, 0).c[0]).toEqual({ t: 'RawInline', c: ['latex', '\\vspace*{1\\baselineskip}\\dictum{'] });
    expect(b(result, 0).c[2]).toEqual({ t: 'RawInline', c: ['latex', '}\\vspace*{24pt}'] });
  });

  it('convierte Div.author a \\dictum[autor]{', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Div',
          c: [
            ['', ['dictum'], []],
            [
              { t: 'Para', c: [{ t: 'Str', c: 'Cita de prueba' }] },
              {
                t: 'Div',
                c: [['', ['author'], []], [{ t: 'Para', c: [{ t: 'Str', c: 'Autor' }] }]],
              },
            ],
          ],
        },
      ],
    };
    const result = await mod.transform(ast);
    expect(b(result, 0).c[0]).toEqual({ t: 'RawInline', c: ['latex', '\\vspace*{0.5\\topskip}\\dictum[Autor]{'] });
    expect(b(result, 0).c[1]).toEqual({ t: 'Str', c: 'Cita de prueba' });
    expect(b(result, 0).c[2]).toEqual({ t: 'RawInline', c: ['latex', '}\\vspace*{32pt}'] });
    expect(result.blocks).toHaveLength(1);
  });

  it('usa RawBlocks de apertura/cierre si el contenido no es un parrafo', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Div',
          c: [['', ['dictum'], []], [{ t: 'BulletList', c: [[{ t: 'Plain', c: [{ t: 'Str', c: 'Item' }] }]] }]],
        },
      ],
    };
    const result = await mod.transform(ast);
    expect(result.blocks).toEqual([
      { t: 'BulletList', c: [[{ t: 'Plain', c: [{ t: 'Str', c: 'Item' }] }]] },
      { t: 'RawBlock', c: ['latex', '\\vspace*{0.5\\topskip}\\dictum{'] },
      { t: 'RawBlock', c: ['latex', '}\\vspace*{32pt}'] },
    ]);
  });

  it('agrega \\noindent al parrafo siguiente despues de un dictum', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Div',
          c: [['', ['dictum'], []], [{ t: 'Para', c: [{ t: 'Str', c: 'Cita' }] }]],
        },
        { t: 'Para', c: [{ t: 'Str', c: 'Texto siguiente' }] },
      ],
    };
    const result = await mod.transform(ast);
    expect(b(result, 1)).toEqual({
      t: 'Para',
      c: [
        { t: 'RawInline', c: ['latex', '\\noindent '] },
        { t: 'Str', c: 'Texto siguiente' },
      ],
    });
  });
});

describe('latex/03-verse (AST transpiler)', () => {
  let mod: TranspilerTestModule;

  beforeAll(async () => {
    mod = (await import('../builder/transpilers/latex/03-verse.ts')) as unknown as TranspilerTestModule;
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
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('retorna el AST sin cambios si blocks está vacío', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('convierte Div.verse en RawBlocks de apertura/cierre con bloques nativos', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Div',
          c: [['', ['verse'], []], [{ t: 'Para', c: [{ t: 'Str', c: 'Texto del poema' }] }]],
        },
      ],
    };
    const result = await mod.transform(ast);
    expect(result.blocks).toEqual([
      { t: 'RawBlock', c: ['latex', '\\vspace*{3pt}\\begin{verse}'] },
      { t: 'Para', c: [{ t: 'Str', c: 'Texto del poema' }] },
      { t: 'RawBlock', c: ['latex', '\\end{verse}\\vspace*{3pt}'] },
    ]);
  });

  it('usa beforeskip/afterskip de los atributos del fenced div', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Div',
          c: [
            [
              '',
              ['verse'],
              [
                ['beforeskip', '1\\baselineskip'],
                ['afterskip', '24pt'],
              ],
            ],
            [{ t: 'Para', c: [{ t: 'Str', c: 'Poema' }] }],
          ],
        },
      ],
    };
    const result = await mod.transform(ast);
    expect(b(result, 0)).toEqual({ t: 'RawBlock', c: ['latex', '\\vspace*{1\\baselineskip}\\begin{verse}'] });
    expect(b(result, 2)).toEqual({ t: 'RawBlock', c: ['latex', '\\end{verse}\\vspace*{24pt}'] });
  });

  it('agrega \\noindent al parrafo siguiente despues de un verse', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [
        {
          t: 'Div',
          c: [['', ['verse'], []], [{ t: 'Para', c: [{ t: 'Str', c: 'Poema' }] }]],
        },
        { t: 'Para', c: [{ t: 'Str', c: 'Texto siguiente' }] },
      ],
    };
    const result = await mod.transform(ast);
    expect(b(result, 3)).toEqual({
      t: 'Para',
      c: [
        { t: 'RawInline', c: ['latex', '\\noindent '] },
        { t: 'Str', c: 'Texto siguiente' },
      ],
    });
  });
});

// ─── 08-mbox-sentence-end ────────────────────────────────────────────────

describe('latex/06-mbox-sentence-end (AST transpiler)', () => {
  let mod: TranspilerTestModule;

  beforeAll(async () => {
    mod = (await import('../builder/transpilers/latex/06-mbox-sentence-end.ts')) as unknown as TranspilerTestModule;
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
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('retorna AST sin cambios si blocks está vacío', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('no modifica un párrafo con menos de 4 palabras', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Hola' }, { t: 'Space' }, { t: 'Str', c: 'mundo' }] }],
    };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('maneja blocks que no es un array', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: 'no-array' };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('maneja bloque Para sin c (inlines)', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [{ t: 'Para' }] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });
});

// ─── 09-mbox-sentence-start ──────────────────────────────────────────────

describe('latex/07-mbox-sentence-start (AST transpiler)', () => {
  let mod: TranspilerTestModule;

  beforeAll(async () => {
    mod = (await import('../builder/transpilers/latex/07-mbox-sentence-start.ts')) as unknown as TranspilerTestModule;
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
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('retorna AST sin cambios si blocks está vacío', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('no modifica un párrafo con menos de 2 palabras', async () => {
    const ast = {
      'pandoc-api-version': [1, 23],
      meta: {},
      blocks: [{ t: 'Para', c: [{ t: 'Str', c: 'Hola' }] }],
    };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('maneja blocks que no es un array', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: 'no-array' };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });

  it('maneja bloque Para sin c (inlines)', async () => {
    const ast = { 'pandoc-api-version': [1, 23], meta: {}, blocks: [{ t: 'Para' }] };
    const result = await mod.transform(ast);
    expect(result).toEqual(ast as unknown as TestAst);
  });
});

// ─── _ast-utils ────────────────────────────────────────────────────────────

describe('_ast-utils (helpers compartidos)', () => {
  let utils: AstUtilsModule;

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

  describe('escapeLatex', () => {
    it('escapa caracteres especiales de LaTeX', () => {
      expect(utils.escapeLatex('100% {real} & \\texto#1_$~^')).toBe(
        '100\\% \\{real\\} \\& \\textbackslash{}texto\\#1\\_\\$\\textasciitilde{}\\textasciicircum{}',
      );
    });
  });

  describe('inlinesToLatex', () => {
    it('convierte Str y Space a texto plano escapado', () => {
      expect(utils.inlinesToLatex([{ t: 'Str', c: 'Autor' }, { t: 'Space' }, { t: 'Str', c: '100%' }])).toBe('Autor 100\\%');
    });

    it('convierte Emph y Strong a comandos LaTeX', () => {
      expect(
        utils.inlinesToLatex([{ t: 'Emph', c: [{ t: 'Str', c: 'cursiva' }] }, { t: 'Space' }, { t: 'Strong', c: [{ t: 'Str', c: 'negrita' }] }]),
      ).toBe('\\emph{cursiva} \\textbf{negrita}');
    });

    it('convierte SoftBreak a espacio y LineBreak a \\\\', () => {
      expect(utils.inlinesToLatex([{ t: 'Str', c: 'a' }, { t: 'SoftBreak' }, { t: 'Str', c: 'b' }, { t: 'LineBreak' }, { t: 'Str', c: 'c' }])).toBe(
        'a b\\\\c',
      );
    });

    it('incluye RawInline latex tal cual', () => {
      expect(
        utils.inlinesToLatex([
          { t: 'Str', c: 'x' },
          { t: 'RawInline', c: ['latex', '\\textbf{y}'] },
        ]),
      ).toBe('x\\textbf{y}');
    });

    it('retorna string vacío para lista vacía', () => {
      expect(utils.inlinesToLatex([])).toBe('');
    });
  });
});
