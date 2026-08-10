import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFilterGroups, markdownToLatex, readDocumentBody } from '../builder/render.js';
import type { BuildDocument } from '../builder/types.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { runPandoc } from '../lib/pandoc-runner.js';

const RESOURCES = join(import.meta.dir, '..', 'lib', 'resources', 'filters');
const SEMANTIC_FILTERS = [
  join(RESOURCES, 'semantic', 'string', '01-double-colon.lua'),
  join(RESOURCES, 'semantic', 'ast', '02-double-colon-noindent.lua'),
];

async function toJson(markdown: string): Promise<Record<string, unknown>> {
  const extraArgs = SEMANTIC_FILTERS.flatMap((f) => ['--lua-filter', f]);
  const stdout = await runPandoc({ input: markdown, sourcePath: 'test.md', to: 'json', extraArgs });
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe('filtros Lua semánticos', () => {
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
  const extraArgs = [...extraFilters, ...HTML_FILTERS].flatMap((f) => ['--lua-filter', f]);
  return runPandoc({ input: markdown, sourcePath: 'test.md', to: 'html5', extraArgs });
}

describe('filtros Lua html', () => {
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

const LATEX_FILTERS = [
  '01-spacer',
  '02-dictum',
  '03-verse',
  '04-center',
  '05-flushright',
  '06-mbox-sentence-end',
  '07-mbox-sentence-start',
  '08-quote-noindent',
].map((n) => join(RESOURCES, 'latex', `${n}.lua`));

async function toLatex(markdown: string): Promise<string> {
  const extraArgs = [...SEMANTIC_FILTERS, ...LATEX_FILTERS].flatMap((f) => ['--lua-filter', f]);
  return runPandoc({ input: markdown, sourcePath: 'test.md', to: 'latex', extraArgs });
}

describe('filtros Lua latex', () => {
  it('convierte :: en \\vspace{\\baselineskip}', async () => {
    const tex = await toLatex('texto\n\n::\n\ntexto');
    expect(tex).toContain('\\vspace{\\baselineskip}');
  });

  it('convierte :; en vspace + \noindent al párrafo siguiente', async () => {
    const tex = await toLatex('texto\n\n:;\n\ntexto siguiente');
    expect(tex).toContain('\\vspace{\\baselineskip}');
    // El umbral de 4 del mbox cuenta palabras reales (el \noindent inline no
    // es una palabra): un párrafo de 2 palabras no recibe mbox.
    expect(tex).toContain('\\noindent texto siguiente');
  });

  it('convierte Div.dictum sin autor', async () => {
    const tex = await toLatex('::: {.dictum}\nCita de prueba\n:::\n');
    expect(tex).toContain('\\dictum{');
    expect(tex).not.toContain('\\vspace*{2\\baselineskip}');
  });

  it('convierte Div.dictum con autor', async () => {
    const tex = await toLatex('::: {.dictum}\nCita\n\n::: {.author}\nJulio Verne\n::: \n:::\n');
    expect(tex).toContain('\\dictum[Julio Verne]{Cita}');
  });

  it('convierte Div.verse sin vspace externo', async () => {
    const tex = await toLatex('::: {.verse}\nPoema\n:::\n');
    expect(tex).toContain('\\begin{verse}');
    expect(tex).toContain('\\end{verse}');
    expect(tex).not.toContain('\\vspace*{3pt}');
  });

  it('agrega \\noindent al párrafo posterior a un blockquote', async () => {
    const tex = await toLatex('> Cita\n\nPárrafo siguiente.\n\nOtro párrafo.\n');
    expect(tex).toContain('\\begin{quote}');
    expect(tex).toContain('\\end{quote}');
    expect(tex).toContain('\\noindent Párrafo siguiente.');
    // Solo el primer párrafo tras el quote lleva \\noindent
    expect(tex.match(/\\noindent/g)).toHaveLength(1);
  });

  it('no agrega \\noindent si el quote no es seguido por un párrafo', async () => {
    const tex = await toLatex('> Cita\n\n### Título\n\nContenido.\n');
    expect(tex).not.toContain('\\noindent Título');
  });

  it('convierte Div.center y Div.flushright', async () => {
    const tex = await toLatex('::: {.center}\nCentrado\n:::\n\n::: {.flushright}\nDerecha\n:::\n');
    expect(tex).toContain('\\begin{center}');
    expect(tex).toContain('\\end{center}');
    expect(tex).toContain('\\begin{flushright}');
    expect(tex).toContain('\\end{flushright}');
  });

  it('mbox-sentence-end envuelve las últimas palabras (1 por oración, 3 en la final)', async () => {
    const tex = await toLatex('Primera oración de ejemplo. Segunda aquí. Tercera oración de ejemplo final.');
    expect(tex).toContain('oración de \\mbox{ejemplo.}');
    expect(tex).toContain('\\mbox{aquí.}');
    expect(tex).toContain('oración \\mbox{de ejemplo final.}');
  });

  it('mbox-sentence-start envuelve la primera palabra de cada oración', async () => {
    const tex = await toLatex('Principio de la oración. Otra oración aquí.');
    expect(tex).toContain('\\mbox{Principio} de la');
    expect(tex).toContain('\\mbox{Otra}');
  });

  it('no modifica párrafos de menos de 4 palabras', async () => {
    const tex = await toLatex('Hola mundo.');
    expect(tex).not.toContain('\\mbox');
  });
});

describe('filtro interno internal/flags (detección estructural)', () => {
  const FLAGS = join(RESOURCES, 'internal', 'flags.lua');
  let dir: string;
  let tplLatex: string;
  let bib: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'iteraciones-flags-'));
    // Template mínimo con los condicionales que el filtro expone vía metadata
    tplLatex = join(dir, 'tpl.tex');
    writeFileSync(
      tplLatex,
      '\\documentclass{article}\n' +
        '$if(has-toc-entries)$\\tableofcontents$endif$\n' +
        '$if(skip-paragraph-space)$$else$\\vspace*{2\\baselineskip}$endif$\n' +
        '$body$\n' +
        '\\end{document}\n',
    );
    bib = join(dir, 'refs.bib');
    writeFileSync(bib, '@book{key1, author = {García, Lucía}, title = {Libro}, year = {2024}}\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function toLatexFlags(md: string, extra: string[] = []): Promise<string> {
    return runPandoc({
      input: md,
      sourcePath: 'test.md',
      to: 'latex',
      extraArgs: ['--template', tplLatex, '--lua-filter', FLAGS, ...extra],
    });
  }

  it('con el primer bloque Header: TOC presente, sin vspace ni noindent', async () => {
    const tex = await toLatexFlags('# Título\n\nPrimer párrafo.');
    expect(tex).toContain('\\tableofcontents');
    expect(tex).not.toContain('\\vspace*{2\\baselineskip}');
    expect(tex).not.toContain('\\noindent');
  });

  it('con el primer bloque Para: sin TOC, con vspace y noindent', async () => {
    const tex = await toLatexFlags('Primer párrafo.\n\nSegundo párrafo.');
    expect(tex).not.toContain('\\tableofcontents');
    expect(tex).toContain('\\vspace*{2\\baselineskip}');
    expect(tex).toContain('\\noindent Primer párrafo.');
  });

  it('un RawBlock \\chapter cuenta como inicio de sección (TOC y sin vspace)', async () => {
    const tex = await toLatexFlags('\\chapter{Capítulo directo}\n\nTexto.');
    expect(tex).toContain('\\tableofcontents');
    expect(tex).not.toContain('\\vspace*{2\\baselineskip}');
  });

  it('\\sectionmark no se confunde con un inicio de sección', async () => {
    const tex = await toLatexFlags('\\sectionmark{Texto}\n\nPárrafo.');
    expect(tex).not.toContain('\\tableofcontents');
    expect(tex).toContain('\\vspace*{2\\baselineskip}');
  });

  it('un dictum inicial omite el vspace y no aplica noindent', async () => {
    const tex = await toLatexFlags('::: {.dictum}\nCita\n:::\n\nTexto.');
    expect(tex).not.toContain('\\vspace*{2\\baselineskip}');
    expect(tex).not.toContain('\\noindent');
  });

  it('un BlockQuote inicial omite el vspace', async () => {
    const tex = await toLatexFlags('> Cita\n\nTexto.');
    expect(tex).not.toContain('\\vspace*{2\\baselineskip}');
  });

  it('Div.center no cuenta como inicio de lista (el vspace se mantiene)', async () => {
    const tex = await toLatexFlags('::: {.center}\nCentrado\n:::\n\nTexto.');
    expect(tex).toContain('\\vspace*{2\\baselineskip}');
  });

  it('agrega \\printbibliography solo con citas y bibliografía', async () => {
    const conCitas = await toLatexFlags('Cita [@key1].', ['--biblatex', '--bibliography', bib]);
    expect(conCitas).toContain('\\printbibliography[heading=bibintoc]');
    const sinBib = await toLatexFlags('Cita [@key1].');
    expect(sinBib).not.toContain('\\printbibliography');
  });

  it('no agrega \\printbibliography sin nodos Cite aunque haya bibliografía', async () => {
    const tex = await toLatexFlags('Texto sin citas.', ['--biblatex', '--bibliography', bib]);
    expect(tex).not.toContain('\\printbibliography');
  });

  it('en HTML agrega el heading sintético de referencias solo con citas y bibliografía', async () => {
    const conCitas = await runPandoc({
      input: 'Cita [@key1].',
      sourcePath: 'test.md',
      to: 'html5',
      extraArgs: ['--lua-filter', FLAGS, '--citeproc', '--bibliography', bib],
    });
    expect(conCitas).toContain('id="referencias"');
    const sinCitas = await runPandoc({
      input: 'Texto.',
      sourcePath: 'test.md',
      to: 'html5',
      extraArgs: ['--lua-filter', FLAGS, '--citeproc', '--bibliography', bib],
    });
    expect(sinCitas).not.toContain('id="referencias"');
  });

  it('en HTML el heading aparece incluso con citas rotas (los nodos Cite existen)', async () => {
    const html = await runPandoc({
      input: 'Cita rota [@no-existe-key].',
      sourcePath: 'test.md',
      to: 'html5',
      extraArgs: ['--lua-filter', FLAGS, '--citeproc', '--bibliography', bib],
    });
    expect(html).toContain('id="referencias"');
  });
});

describe('filtros Lua de usuario', () => {
  const USER_FILTER = [
    '-- Convierte Div.nota según el formato de salida',
    'function Div(div)',
    '  if not div.classes:includes("nota") then return nil end',
    '  if FORMAT == "latex" then',
    '    return pandoc.RawBlock("latex", "\\\\fbox{Nota}")',
    '  elseif FORMAT == "html5" then',
    '    return pandoc.RawBlock("html", \'<aside class="nota">Nota</aside>\')',
    '  end',
    '  return nil',
    'end',
  ].join('\n');

  it('un filtro de usuario se condiciona por FORMAT', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-user-lua-'));
    try {
      mkdirSync(join(cwd, 'filters'), { recursive: true });
      writeFileSync(join(cwd, 'filters', 'nota.lua'), USER_FILTER);
      const md = '::: {.nota}\nImportante\n:::\n';
      const tex = await runPandoc({ input: md, sourcePath: 'test.md', to: 'latex', extraArgs: ['--lua-filter', join(cwd, 'filters', 'nota.lua')] });
      expect(tex).toContain('\\fbox{Nota}');
      const html = await runPandoc({ input: md, sourcePath: 'test.md', to: 'html5', extraArgs: ['--lua-filter', join(cwd, 'filters', 'nota.lua')] });
      expect(html).toContain('<aside class="nota">');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('el pipeline (markdownToLatex) aplica los lua-filters del proyecto', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-user-lua-'));
    try {
      mkdirSync(join(cwd, 'filters'), { recursive: true });
      writeFileSync(join(cwd, 'filters', 'nota.lua'), USER_FILTER);
      writeFileSync(join(cwd, 'iteraciones.config.yaml'), 'lua-filters:\n  - filters/nota.lua\n');
      writeFileSync(join(cwd, 'doc.md'), '---\ntitle: Prueba\n---\n\n::: {.nota}\nImportante\n:::\n');
      const doc: BuildDocument = {
        filePath: join(cwd, 'doc.md'),
        relativePath: 'doc.md',
        frontmatter: { title: 'Prueba', date: '', author: [] },
        slug: 'prueba',
      };
      const siteConfig = await loadSiteConfig(cwd);
      const filters = await loadFilterGroups(siteConfig, undefined, cwd);
      const templatePath = join(cwd, 'tpl.tex');
      writeFileSync(templatePath, '\\documentclass{article}\n\\begin{document}\n$body$\n\\end{document}\n');
      const body = await readDocumentBody(doc);
      const tex = await markdownToLatex(body, doc, filters, [], templatePath, { title: 'Prueba' }, siteConfig);
      expect(tex).toContain('\\fbox{Nota}');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
