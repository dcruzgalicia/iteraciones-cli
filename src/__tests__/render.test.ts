import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computePreambleFlags, hasCiteNodes, renderFromAstCache } from '../builder/render.js';
import type { BuildDocument } from '../builder/types.js';

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
  it('retorna mapa vacío si no hay AST serializado en disco', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-ast-'));
    try {
      const doc: BuildDocument = {
        filePath: join(cwd, 'doc.md'),
        relativePath: 'doc.md',
        frontmatter: { title: 'Prueba', date: '', author: [] },
        slug: 'prueba',
      };
      const results = await renderFromAstCache([doc], 1, cwd, false);
      expect(results.size).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
