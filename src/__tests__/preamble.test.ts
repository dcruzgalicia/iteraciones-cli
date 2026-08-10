import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeLatexTemplate } from '../builder/latex-preamble.js';
import {
  getBuiltinPreambleFilterInfos,
  getBuiltinPreambleFilterNames,
  loadPreambleFilters,
  validateDisabledPreambleFilters,
} from '../builder/preamble-loader.js';
import * as logger from '../lib/logger.js';
import { checkPandoc, runPandoc } from '../lib/pandoc-runner.js';

const pandocOk = await checkPandoc().catch(() => null);

describe('preamble-loader', () => {
  it('lista los preamble filters built-in con descripción', async () => {
    const infos = await getBuiltinPreambleFilterInfos();
    const names = getBuiltinPreambleFilterNames();
    expect(infos).toHaveLength(names.length);
    expect(infos.map((i) => i.name)).toEqual(names);
    expect(infos.every((i) => i.description.length > 0)).toBe(true);
  });

  it('carga el contenido .tex del paquete para todos los filters', async () => {
    const filters = await loadPreambleFilters();
    expect(filters).toHaveLength(getBuiltinPreambleFilterNames().length);
    const biblio = filters.find((t) => t.name === '18-bibliography-heading');
    expect(biblio?.content).toContain('\\ifcsname ver@biblatex.sty\\endcsname');
    expect(biblio?.content).toContain('\\defbibheading{bibintoc}[\\refname]{%');
    const maketitle = filters.find((t) => t.name === '19-maketitle');
    expect(maketitle?.content).toContain('\\renewcommand{\\maketitle}{%');
  });

  it('respeta la disabled list', async () => {
    const filters = await loadPreambleFilters(['15-hyphenation-rules']);
    expect(filters.map((t) => t.name)).not.toContain('15-hyphenation-rules');
    expect(filters).toHaveLength(getBuiltinPreambleFilterNames().length - 1);
  });

  it('un .tex del proyecto reemplaza al del paquete', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-preamble-'));
    try {
      mkdirSync(join(cwd, 'preamble'), { recursive: true });
      writeFileSync(join(cwd, 'preamble', '15-hyphenation-rules.tex'), 'hyphenation{OverridePrueba}\n');
      const filters = await loadPreambleFilters(undefined, cwd);
      const hyphen = filters.find((t) => t.name === '15-hyphenation-rules');
      expect(hyphen?.content).toContain('OverridePrueba');
      expect(hyphen?.content).not.toContain('Separacion silabica');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('composeLatexTemplate', () => {
  const opts = { pageNumber: 'header-right', toc: true, preambleFilters: [], bibFiles: [] };

  it('compone la portada con fragmentos de template (variables de pandoc)', async () => {
    const tpl = await composeLatexTemplate(opts);
    expect(tpl).toContain('\\title{$title$}');
    expect(tpl).toContain('$if(subtitle)$\n\\subtitle{$subtitle$}\n$endif$');
    expect(tpl).toContain('\\author{$for(author)$$author$$sep$ \\and $endfor$}');
    expect(tpl).toContain('\\date{$date$}');
    expect(tpl).toContain('\\maketitle');
  });

  it('emite \\tableofcontents condicional solo con toc configurado', async () => {
    const withToc = await composeLatexTemplate(opts);
    const withoutToc = await composeLatexTemplate({ ...opts, toc: false });
    expect(withToc).toContain('$if(has-toc-entries)$\n\\tableofcontents\n$endif$');
    expect(withoutToc).not.toContain('\\tableofcontents');
  });

  it('emite el vspace post-portada condicional por skip-paragraph-space', async () => {
    const tpl = await composeLatexTemplate(opts);
    expect(tpl).toContain('$if(skip-paragraph-space)$\n$else$\n\\vspace*{2\\baselineskip}\n$endif$');
  });

  it('incluye el comando de número de página configurado', async () => {
    const tpl = await composeLatexTemplate({ ...opts, pageNumber: 'footer-center' });
    expect(tpl).toContain('\\cfoot*{\\pagemark}');
  });

  it('lanza BuildError con page-number inválido', async () => {
    await expect(composeLatexTemplate({ ...opts, pageNumber: 'raro' })).rejects.toThrow('page-number inválido');
  });

  it('escapa rutas de bibliografía en \\addbibresource sin tocar guiones bajos', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'iteraciones-preamble-'));
    try {
      writeFileSync(join(cwd, 'mi_bib%1.bib'), '@book{k1, title={T}, year={2020}}\n');
      const tpl = await composeLatexTemplate({ ...opts, bibFiles: [join(cwd, 'mi_bib%1.bib')] });
      expect(tpl).toContain(`\\addbibresource{${join(cwd, 'mi_bib%1.bib').replace('%', '\\%')}}`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('concilia el $body$ con líneas en blanco (formato del .tex final)', async () => {
    const tpl = await composeLatexTemplate(opts);
    const lines = tpl.split('\n');
    const bodyIdx = lines.indexOf('$body$');
    expect(lines[bodyIdx - 1]).toBe('');
    expect(lines[bodyIdx + 1]).toBe('');
  });

  it('no contiene caracteres de control (escapado correcto de backslashes)', async () => {
    const tpl = await composeLatexTemplate(opts);
    expect(tpl).not.toContain('\u0008');
    expect(tpl).not.toContain('\t');
  });

  it.skipIf(!pandocOk)('pandoc escapa los metadatos al renderizar el template (título y autor)', async () => {
    const tpl = await composeLatexTemplate({ ...opts, toc: false });
    const dir = mkdtempSync(join(tmpdir(), 'iteraciones-latex-tpl-'));
    try {
      writeFileSync(join(dir, 'tpl.tex'), tpl);
      const out = await runPandoc({
        input: 'Texto.',
        sourcePath: 'test.md',
        to: 'latex',
        extraArgs: ['--template', join(dir, 'tpl.tex'), '--metadata=title:Resultados 100% & Análisis', '--metadata=author:Ana & Torres'],
      });
      expect(out).toContain('\\title{Resultados 100\\% \\& Análisis}');
      expect(out).toContain('\\author{Ana \\& Torres}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validateDisabledPreambleFilters', () => {
  it('no advierte con undefined o lista vacía', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledPreambleFilters(undefined);
    validateDisabledPreambleFilters([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('no advierte con nombres válidos', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledPreambleFilters(['15-hyphenation-rules']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('advierte con un nombre desconocido', () => {
    const spy = spyOn(logger, 'logWarning');
    validateDisabledPreambleFilters(['99-no-existe']);
    expect(spy).toHaveBeenCalledWith('disabled-preamble-filters: "99-no-existe" no coincide con ningún preamble filter', 'config');
    spy.mockRestore();
  });
});
