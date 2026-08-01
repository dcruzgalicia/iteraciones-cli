import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { runPandoc } from '../lib/pandoc-runner.js';

const RESOURCES = join(import.meta.dir, '..', 'lib', 'resources', 'transpilers');
const SEMANTIC_FILTERS = [
  join(RESOURCES, 'semantic', 'string', '01-double-colon.lua'),
  join(RESOURCES, 'semantic', 'ast', '02-double-colon-noindent.lua'),
];

async function toJson(markdown: string): Promise<Record<string, unknown>> {
  const args = ['pandoc', '--from', 'markdown', '--to', 'json'];
  for (const f of SEMANTIC_FILTERS) args.push('--lua-filter', f);
  const { stdout } = await runPandoc(args, markdown, 'test.md');
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe('filtros Lua semánticos (Fase 6, B1)', () => {
  it('convierte :: sola en una línea a Div.spacer', async () => {
    const ast = await toJson('texto antes\n\n::\n\ntexto después');
    expect(ast.blocks).toEqual([
      { t: 'Para', c: [{ t: 'Str', c: 'texto' }, { t: 'Space' }, { t: 'Str', c: 'antes' }] },
      { t: 'Div', c: [['', ['spacer'], []], []] },
      { t: 'Para', c: [{ t: 'Str', c: 'texto' }, { t: 'Space' }, { t: 'Str', c: 'después' }] },
    ]);
  });

  it('convierte :; a Div.spacer noindent', async () => {
    const ast = await toJson('texto\n\n:;\n\ntexto');
    const spacer = (ast.blocks as unknown[]).find((b) => (b as { t: string }).t === 'Div');
    expect(spacer).toEqual({ t: 'Div', c: [['', ['spacer', 'noindent'], []], []] });
  });

  it('no modifica :: con texto en la misma línea', async () => {
    const ast = await toJson(':: con texto');
    expect(ast.blocks).toEqual([
      { t: 'Para', c: [{ t: 'Str', c: '::' }, { t: 'Space' }, { t: 'Str', c: 'con' }, { t: 'Space' }, { t: 'Str', c: 'texto' }] },
    ]);
  });

  it('no modifica texto sin :: ni :;', async () => {
    const ast = await toJson('texto normal');
    expect(ast.blocks).toEqual([{ t: 'Para', c: [{ t: 'Str', c: 'texto' }, { t: 'Space' }, { t: 'Str', c: 'normal' }] }]);
  });

  it('convierte múltiples :: en la misma pasada', async () => {
    const ast = await toJson('a\n\n::\n\nb\n\n::\n\nc');
    const divs = (ast.blocks as unknown[]).filter((b) => (b as { t: string }).t === 'Div');
    expect(divs).toHaveLength(2);
  });

  it('no modifica :: dentro de un bloque de código', async () => {
    const ast = await toJson('```\n::\n```');
    expect(ast.blocks).toEqual([{ t: 'CodeBlock', c: [['', [], []], '::'] }]);
  });
});
