import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { babelOptionsForLang, composeLatexTemplate } from '../builder/latex-preamble.js';
import {
  getBuiltinPreambleFilterInfos,
  getBuiltinPreambleFilterNames,
  loadPreambleFilters,
  validateDisabledPreambleFilters,
  validatePreambleDependencies,
} from '../builder/preamble-loader.js';
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
    // 02-fonts usa newtxtext (versalitas reales; mathptmx las degeneraba)
    const fonts = filters.find((t) => t.name === '02-fonts');
    expect(fonts?.content).toContain('\\usepackage{newtxtext}');
    expect(fonts?.content).not.toContain('\\usepackage{mathptmx}');
    // 05-language expone el idioma como variable de template (la interpola
    // pandoc con el metadata babel-lang que pasa el CLI)
    const language = filters.find((t) => t.name === '05-language');
    expect(language?.content).toContain('$if(babel-lang)$');
    expect(language?.content).toContain('\\usepackage[$babel-lang$]{babel}');
  });

  it('el maketitle usa los saltos propios (titlepage@next) y no el setparsizes de KOMA', async () => {
    // Regresión: \\next@tpage/\\next@tdpage ejecutan \\setparsizes{0}{0} que
    // deja \\parindent a 0 de forma global: el body pierde la indentación.
    const filters = await loadPreambleFilters();
    const maketitle = filters.find((t) => t.name === '19-maketitle')?.content ?? '';
    const titlepages = filters.find((t) => t.name === '28-titlepages')?.content ?? '';
    expect(titlepages).toContain('\\newcommand{\\titlepage@next}');
    expect(titlepages).toContain('\\newcommand{\\titlepage@nextdouble}');
    expect(maketitle).toContain('\\titlepage@next');
    // Solo el código (sin los comentarios %, que explican la decisión)
    const code = maketitle
      .split('\n')
      .filter((l) => !l.trim().startsWith('%'))
      .join('\n');
    expect(code).not.toContain('\\next@tpage');
    expect(code).not.toContain('\\next@tdpage');
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

describe('babelOptionsForLang (contrato lang → babel en el PDF)', () => {
  it('mapea es-MX a las opciones históricas de español de México', () => {
    expect(babelOptionsForLang('es-MX')).toBe('spanish,mexico,es-noshorthands,es-noindentfirst');
  });

  it('mapea es a español sin la variante de México', () => {
    expect(babelOptionsForLang('es')).toBe('spanish,es-noshorthands,es-noindentfirst');
  });

  it('mapea en y sus variantes a english', () => {
    expect(babelOptionsForLang('en')).toBe('english');
    expect(babelOptionsForLang('en-US')).toBe('english');
  });

  it('resuelve por idioma base las variantes no listadas (fr-CA → french)', () => {
    expect(babelOptionsForLang('fr-CA')).toBe('french');
  });

  it('cae a español con warning único para idiomas desconocidos', async () => {
    const warnSpy = spyOn(console, 'warn');
    // El warning usa logWarning (stderr): se captura por el spy de stderr
    const stderrSpy = spyOn(process.stderr, 'write');
    try {
      expect(babelOptionsForLang('xx-YY')).toBe('spanish,es-noshorthands,es-noindentfirst');
      // Solo un warning aunque se consulte dos veces (por documento)
      expect(babelOptionsForLang('xx-YY')).toBe('spanish,es-noshorthands,es-noindentfirst');
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect((output.match(/sin opciones babel conocidas/g) ?? []).length).toBe(1);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe('validatePreambleDependencies (dependencias entre filters)', () => {
  it('sin disabled list no produce issues', () => {
    expect(validatePreambleDependencies(undefined)).toEqual([]);
    expect(validatePreambleDependencies([])).toEqual([]);
  });

  it('desactivar 05-language sin 16-toc-styling es un error (renewcaptionname de babel)', () => {
    const issues = validatePreambleDependencies(['05-language']);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('16-toc-styling'))).toBe(true);
  });

  it('desactivar ambos (05 y 16) no produce el error', () => {
    const issues = validatePreambleDependencies(['05-language', '16-toc-styling']);
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('25-pdfx con 08-hyperref activo es un warning (enlaces desactivados por PDF/X-1a)', () => {
    const issues = validatePreambleDependencies(['24-eso-pic', '26-crop']); // 25 activo
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('25-pdfx'))).toBe(true);
  });

  it('con 25-pdfx desactivado no hay warning de enlaces', () => {
    const issues = validatePreambleDependencies(undefined);
    expect(issues.some((i) => i.message.includes('25-pdfx'))).toBe(false);
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

  it('emite los condicionales de las páginas de título internas (frontmatter)', async () => {
    const tpl = await composeLatexTemplate(opts);
    expect(tpl).toContain('$if(extratitle)$\n\\extratitle{$extratitle$}\n$endif$');
    expect(tpl).toContain('$if(dedication)$\n\\dedication{$dedication$}\n$endif$');
    expect(tpl).toContain('$if(uppertitleback)$\n\\uppertitleback{$uppertitleback$}\n$endif$');
    expect(tpl).toContain('$if(lowertitleback)$\n\\lowertitleback{$lowertitleback$}\n$endif$');
  });

  it('emite el vspace post-portada solo con párrafo normal (skip-paragraph-space)', async () => {
    const tpl = await composeLatexTemplate(opts);
    expect(tpl).toContain('$if(skip-paragraph-space)$\n$else$\n\\vspace*{2\\baselineskip}\n$endif$');
  });

  it('emite \\tableofcontents condicional solo con toc configurado', async () => {
    const withToc = await composeLatexTemplate(opts);
    const withoutToc = await composeLatexTemplate({ ...opts, toc: false });
    expect(withToc).toContain('$if(has-toc-entries)$\n\\tableofcontents\n$endif$');
    expect(withoutToc).not.toContain('\\tableofcontents');
  });

  it('incluye el comando de número de página configurado', async () => {
    const tpl = await composeLatexTemplate({ ...opts, pageNumber: 'footer-center' });
    expect(tpl).toContain('\\cfoot*{\\pagemark}');
  });

  it('emite el comando de página solo con párrafo normal (sin pagestyle explícito)', async () => {
    const tpl = await composeLatexTemplate({ ...opts, pageNumber: 'footer-right' });
    expect(tpl).toContain('$if(skip-paragraph-space)$\n$else$\n\\ofoot*{\\pagemark}\n$endif$');
    expect(tpl).not.toContain('\\pagestyle{empty}');
    expect(tpl).not.toContain('\\pagestyle{headings}');
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

  it('05-language compone el condicional babel por el metadata babel-lang', async () => {
    const filters = await loadPreambleFilters();
    const tpl = await composeLatexTemplate({ ...opts, preambleFilters: filters.filter((f) => f.name === '05-language') });
    expect(tpl).toContain('$if(babel-lang)$\n\\usepackage[$babel-lang$]{babel}\n$else$');
    expect(tpl).toContain('$endif$');
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
  it('no lanza con undefined o lista vacía', () => {
    expect(() => validateDisabledPreambleFilters(undefined)).not.toThrow();
    expect(() => validateDisabledPreambleFilters([])).not.toThrow();
  });

  it('no lanza con nombres válidos', () => {
    expect(() => validateDisabledPreambleFilters(['15-hyphenation-rules'])).not.toThrow();
  });

  it('lanza BuildError con un nombre desconocido', () => {
    expect(() => validateDisabledPreambleFilters(['99-no-existe'])).toThrow(
      'disabled-preamble-filters: "99-no-existe" no coincide con ningún preamble filter',
    );
  });
});
