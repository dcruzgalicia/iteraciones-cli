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

const HTML_FILTERS = ['01-dictum', '02-verse', '03-center', '04-flushright', '05-spacer'].map((n) => join(RESOURCES, 'html', `${n}.lua`));

async function toHtml5(markdown: string, extraFilters: string[] = []): Promise<string> {
  const args = ['pandoc', '--from', 'markdown', '--to', 'html5'];
  for (const f of [...extraFilters, ...HTML_FILTERS]) args.push('--lua-filter', f);
  const { stdout } = await runPandoc(args, markdown, 'test.md');
  return stdout;
}

describe('filtros Lua html (Fase 6, B3)', () => {
  it('envuelve Div.dictum en blockquote con bloques nativos', async () => {
    const html = await toHtml5('::: {.dictum}\nCita de prueba\n:::\n');
    expect(html).toContain('<blockquote class="dictum">');
    expect(html).toContain('<p>Cita de prueba</p>');
    expect(html).toContain('</blockquote>');
  });

  it('envuelve Div.verse en div', async () => {
    const html = await toHtml5('::: {.verse}\nPoema\n:::\n');
    expect(html).toContain('<div class="verse">');
    expect(html).toContain('</div>');
  });

  it('envuelve Div.center en div', async () => {
    const html = await toHtml5('::: {.center}\nCentrado\n:::\n');
    expect(html).toContain('<div class="center">');
  });

  it('envuelve Div.flushright en div', async () => {
    const html = await toHtml5('::: {.flushright}\nDerecha\n:::\n');
    expect(html).toContain('<div class="flushright">');
  });

  it('convierte :: (Div.spacer) en div vacío con los filtros semánticos', async () => {
    const html = await toHtml5('texto\n\n::\n\ntexto', SEMANTIC_FILTERS);
    expect(html).toContain('<div class="spacer"></div>');
  });

  it('no altera párrafos normales', async () => {
    const html = await toHtml5('Párrafo normal');
    expect(html).toContain('<p>Párrafo normal</p>');
    expect(html).not.toContain('blockquote');
    expect(html).not.toContain('class="spacer"');
  });
});
