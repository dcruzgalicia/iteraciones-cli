import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyPrintQueueDynamics,
  babelOptionsForLang,
  buildCropContent,
  buildPdfxPagesattr,
  composeLatexTemplate,
  detectPageSize,
} from '../builder/latex-preamble.js';
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

  it('la cola de imprenta (97-eso-pic, 98-crop, 99-pdfx) es siempre la última en el orden derivado', () => {
    const names = getBuiltinPreambleFilterNames();
    // La cola de imprenta (fondo, marcas de corte, PDF/X-1a) ocupa
    // deliberadamente los últimos tres preámbulos, en ese orden: ningún filter
    // futuro puede quedar después (issue #1952).
    expect(names.slice(-3)).toEqual(['97-eso-pic', '98-crop', '99-pdfx']);
    const maxNumeric = names.reduce((max, n) => {
      const m = n.match(/^(\d+)-/);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    expect(maxNumeric).toBe(99);
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
    expect(babelOptionsForLang('es-MX', new Set())).toBe('spanish,mexico,es-noshorthands,es-noindentfirst');
  });

  it('mapea es a español sin la variante de México', () => {
    expect(babelOptionsForLang('es', new Set())).toBe('spanish,es-noshorthands,es-noindentfirst');
  });

  it('mapea en y sus variantes a english', () => {
    expect(babelOptionsForLang('en', new Set())).toBe('english');
    expect(babelOptionsForLang('en-US', new Set())).toBe('english');
  });

  it('resuelve por idioma base las variantes no listadas (fr-CA → french)', () => {
    expect(babelOptionsForLang('fr-CA', new Set())).toBe('french');
  });

  it('cae a español con warning único por build para idiomas desconocidos', async () => {
    const stderrSpy = spyOn(process.stderr, 'write');
    try {
      // Mismo registro (mismo build): un solo warning aunque se consulte dos veces
      const warned = new Set<string>();
      expect(babelOptionsForLang('xx-YY', warned)).toBe('spanish,es-noshorthands,es-noindentfirst');
      expect(babelOptionsForLang('xx-YY', warned)).toBe('spanish,es-noshorthands,es-noindentfirst');
      let output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect((output.match(/sin opciones babel conocidas/g) ?? []).length).toBe(1);
      // Registro distinto (segundo build en el mismo proceso): warning de nuevo
      expect(babelOptionsForLang('xx-YY', new Set())).toBe('spanish,es-noshorthands,es-noindentfirst');
      output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect((output.match(/sin opciones babel conocidas/g) ?? []).length).toBe(2);
    } finally {
      stderrSpy.mockRestore();
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

  it('99-pdfx con 08-hyperref activo es un warning (enlaces desactivados por PDF/X-1a)', () => {
    const issues = validatePreambleDependencies(['97-eso-pic', '98-crop']); // 99 activo
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('99-pdfx'))).toBe(true);
  });

  it('con 99-pdfx desactivado no hay warning de enlaces', () => {
    const issues = validatePreambleDependencies(undefined);
    expect(issues.some((i) => i.message.includes('99-pdfx'))).toBe(false);
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
    expect(tpl).toContain('$if(frontispiece)$\n\\frontispiece{$frontispiece$}\n$endif$');
    expect(tpl).toContain('$if(titlehead)$\n\\titlehead{$titlehead$}\n$endif$');
    expect(tpl).toContain('$if(subject)$\n\\subject{$subject$}\n$endif$');
    expect(tpl).toContain('$if(dedication)$\n\\dedication{$dedication$}\n$endif$');
    expect(tpl).toContain('$if(uppertitleback)$\n\\uppertitleback{$uppertitleback$}\n$endif$');
    expect(tpl).toContain('$if(lowertitleback)$\n\\lowertitleback{$lowertitleback$}\n$endif$');
    expect(tpl).toContain('$if(publishers)$\n\\publishers{$publishers$}\n$endif$');
    expect(tpl).toContain('$if(publishers-image)$\n\\publishersimage{$publishers-image$}\n$endif$');
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

  it('emite el condicional de title-image (imagen de portada) junto al título', async () => {
    const tpl = await composeLatexTemplate(opts);
    expect(tpl).toContain('$if(title-image)$\n\\titleimage{$title-image$}\n$endif$');
    const lines = tpl.split('\n');
    const titleIdx = lines.indexOf('\\title{$title$}');
    const titleImageIdx = lines.indexOf('\\titleimage{$title-image$}');
    expect(titleImageIdx).toBeGreaterThan(titleIdx);
  });

  it('emite el colofón condicional DESPUÉS del $body$ (última página del documento)', async () => {
    const tpl = await composeLatexTemplate(opts);
    expect(tpl).toContain('$if(colophon)$\n\\colophon{$colophon$}\n\\colophonpage\n$endif$');
    const lines = tpl.split('\n');
    const bodyIdx = lines.indexOf('$body$');
    const colophonIdx = lines.indexOf('\\colophonpage');
    expect(colophonIdx).toBeGreaterThan(bodyIdx);
    expect(lines[lines.length - 1]).toBe('\\end{document}');
    expect(colophonIdx).toBeLessThan(lines.indexOf('\\end{document}'));
  });

  it('28-titlepages: colophon long y saltos a página par (titlepage@lasteven)', async () => {
    const filters = await loadPreambleFilters();
    const titlepages = filters.find((f) => f.name === '28-titlepages')?.content ?? '';
    expect(titlepages).toContain('\\newcommand{\\colophon}[1]{\\gdef\\@colophon{%');
    expect(titlepages).toContain('\\newcommand{\\titlepage@lasteven}{%');
    // Espejo de nextdouble: si la página tras \clearpage es impar, se inserta
    // una en blanco y el colofón cae en la siguiente par.
    expect(titlepages).toContain('\\ifodd\\value{page}\\null\\titlepage@next');
    expect(titlepages).toContain('\\vspace*{7\\baselineskip}');
    // Regresión: un $body$ literal en un comentario se interpola por el
    // template de pandoc (el preamble va dentro del template) y rompe el PDF
    // con 'Missing \\begin{document}'.
    expect(titlepages).not.toContain('$body$');
  });

  it('28-titlepages: title-image abre el colofón (50% textwidth) y publishers-image lo cierra (25% textwidth)', async () => {
    const filters = await loadPreambleFilters();
    const titlepages = filters.find((f) => f.name === '28-titlepages')?.content ?? '';
    const colophon = titlepages.slice(titlepages.indexOf('\\newcommand{\\colophonpage}{%'));
    expect(colophon).toContain('\\titleimagerender[0.5\\textwidth]{\\@titleimage}');
    expect(colophon).toContain('\\titleimagerender[0.25\\textwidth]{\\@publishersimage}');
    // Orden: imagen de título → bloque de colophon → logo de publishers
    const titleImg = colophon.indexOf('\\@titleimage');
    const block = colophon.indexOf('\\@colophon');
    const pubImg = colophon.indexOf('\\@publishersimage');
    expect(titleImg).toBeGreaterThan(-1);
    expect(titleImg).toBeLessThan(block);
    expect(block).toBeLessThan(pubImg);
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

describe('valores de maquetación editorial (issue 1810)', () => {
  it('07-typography: pretolerance 200, tolerance 300 y hyphenpenalty 100', async () => {
    const filters = await loadPreambleFilters();
    const typo = filters.find((f) => f.name === '07-typography')?.content ?? '';
    expect(typo).toContain('\\pretolerance=200');
    expect(typo).toContain('\\tolerance=300');
    expect(typo).toContain('\\hyphenpenalty=100');
    expect(typo).not.toContain('\\tolerance=400');
    // microtype con más elasticidad de espaciado
    expect(typo).toContain('stretch=20,shrink=20');
  });

  it('14-sectioning: beforeskip 2 para part/chapter/section/subsection y afterskip 2 para section/subsection', async () => {
    const filters = await loadPreambleFilters();
    const sectioning = filters.find((f) => f.name === '14-sectioning')?.content ?? '';
    expect(sectioning).toContain('beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{part}');
    expect(sectioning).toContain('beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{chapter}');
    expect(sectioning).toContain('beforeskip=2\\baselineskip,afterskip=2\\baselineskip,afterindent=false]{section}');
    expect(sectioning).toContain('beforeskip=2\\baselineskip,afterskip=2\\baselineskip,afterindent=false]{subsection}');
    // subsubsection/paragraph/subparagraph conservan 1
    expect(sectioning).toContain('beforeskip=\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}');
  });

  it('21-dictum: topsep de 2 baselineskips', async () => {
    const filters = await loadPreambleFilters();
    const dictum = filters.find((f) => f.name === '21-dictum')?.content ?? '';
    expect(dictum).toContain('\\topsep=2\\baselineskip');
    expect(dictum).not.toContain('\\topsep=\\baselineskip');
  });

  it('19-maketitle: dedication con vspace de 7 baselineskips (extratitle centrado vertical exacto)', async () => {
    const filters = await loadPreambleFilters();
    const maketitle = filters.find((f) => f.name === '19-maketitle')?.content ?? '';
    expect(maketitle).toContain('\\vspace*{7\\baselineskip}'); // dedication
    // Posicionamiento fijo con vbox to textheight: \vspace*{10\baselineskip}
    // ancla el bloque de contenido con espacio fijo desde arriba
    expect(maketitle).toContain('\\vbox to \\textheight{%');
    expect(maketitle).toContain('\\vspace*{10\\baselineskip}');
  });

  it('19-maketitle: subtitle long (parrafos con linea en blanco) y parindent cero en las paginas de titulo', async () => {
    // Regresión: KOMA define \subtitle con \newcommand* (no-long); una línea en
    // blanco en el argumento rompía la compilación ('Paragraph ended before
    // \subtitle was complete'). \parindent\z@ evita la indentación del primer
    // y siguientes párrafos (\noindent solo afecta al primero).
    const filters = await loadPreambleFilters();
    const maketitle = filters.find((f) => f.name === '19-maketitle')?.content ?? '';
    expect(maketitle).toContain('\\renewcommand{\\subtitle}[1]{\\gdef\\@subtitle{%');
    expect(maketitle).toContain('\\parindent\\z@\\@subtitle\\par');
    expect(maketitle).not.toContain('\\centering\\noindent');
  });

  it('19-maketitle: title-image con graphicx, ancho maximo configurable y extratitle sustituido', async () => {
    const filters = await loadPreambleFilters();
    const maketitle = filters.find((f) => f.name === '19-maketitle')?.content ?? '';
    expect(maketitle).toContain('\\usepackage{graphicx}');
    expect(maketitle).toContain('\\newcommand{\\titleimage}[1]{\\gdef\\@titleimage{%');
    expect(maketitle).toContain('\\ifx\\@titleimage\\@empty');
    expect(maketitle).toContain('\\titleimagerender{\\@titleimage}');
    expect(maketitle).toContain('\\publishersimage');
    expect(maketitle).toContain('\\ifx\\@publishersimage\\@empty');
    // publishers-image: la imagen sustituye al texto (máx. 150pt ≈ 150px)
    expect(maketitle).toContain('\\titleimagerender[150pt]{\\@publishersimage}');
    // Max-width configurable: default 0.8 textwidth (portada) y
    // [\extratitlewidth] (100% del ancho del bloque) en la página de extratitle
    expect(maketitle).toContain('\\newcommand{\\titleimagerender}[2][0.8\\textwidth]{%');
    expect(maketitle).toContain('\\ifdim\\wd\\titleimagebox>#1');
    expect(maketitle).toContain('width=#1,keepaspectratio');
    expect(maketitle).toContain('\\usebox{\\titleimagebox}');
    expect(maketitle).toContain('\\titleimagerender[\\extratitlewidth]{\\@titleimage}');
    // Con title-image, el texto de extratitle se sustituye: la rama textual
    // queda anidada bajo \\ifx\\@titleimage\\@empty
    expect(maketitle).toContain('\\ifx\\@titleimage\\@empty\n    \\ifx\\@extratitle\\@empty');
  });

  it('19-maketitle: frontispiece, titlehead, subject y publishers en el maketitle', async () => {
    const filters = await loadPreambleFilters();
    const maketitle = filters.find((f) => f.name === '19-maketitle')?.content ?? '';
    // Frontispicio: página anterior a la portada con contenido anclado al fondo
    expect(maketitle).toContain('\\ifx\\@frontispiece\\@empty\\else');
    expect(maketitle).toContain('\\vspace*{\\fill}%\n    {\\centering\\parindent\\z@\\@frontispiece\\par}%');
    // Extratitle por defecto: frontispiece sin extratitle ni title-image → título
    expect(maketitle).toContain('\\ifx\\@frontispiece\\@empty\n        % sin página de extratitle');
    expect(maketitle).toContain('{\\centering\\parindent\\z@\\@title\\par}%');
    // Orden de la portada: author → title → subtitle → subject → titlehead →
    // date → publishers (titlehead va después de subject; date antes de
    // publishers). Cadenas específicas: \@title también aparece dentro de
    // \@titleimage.
    const head = maketitle.indexOf('\\@titlehead\\par');
    const author = maketitle.indexOf('\\@author\\par');
    const title = maketitle.indexOf('\\MakeUppercase{\\@title}');
    const sub = maketitle.indexOf('\\@subtitle\\par');
    const subject = maketitle.indexOf('\\@subject\\par');
    const date = maketitle.indexOf('\\@date\\par');
    const pub = maketitle.indexOf('\\@publishers\\par');
    expect(author).toBeGreaterThan(-1);
    expect(author).toBeLessThan(title);
    expect(title).toBeLessThan(sub);
    expect(sub).toBeLessThan(subject);
    expect(subject).toBeLessThan(date);
    expect(date).toBeLessThan(head);
    expect(head).toBeLessThan(pub);
  });

  it('19-maketitle: dos paginas en blanco antes de extratitle (hojas de guarda)', async () => {
    const filters = await loadPreambleFilters();
    const maketitle = filters.find((f) => f.name === '19-maketitle')?.content ?? '';
    expect(maketitle).toContain('\\newcommand{\\titlepageblanks}{%');
    expect(maketitle).toContain('\\null\\clearpage\n  \\null\\clearpage');
    // Las tres ramas de extratitle (por defecto, textual y con title-image)
    // llaman a titlepageblanks: definición + 3 llamadas
    expect((maketitle.match(/\\titlepageblanks/g) ?? []).length).toBe(4);
    // Bandera para 30-endpapers: las guardas existen (el endpaper solo se
    // dibuja sobre la hoja en blanco de la página 1)
    expect(maketitle).toContain('\\newif\\iftitlepageguards');
    expect(maketitle).toContain('\\titlepageguardstrue');
  });

  it('19-maketitle: bloques extratitle (75% centrado) y dedication (50% derecha) como el dictum', async () => {
    const filters = await loadPreambleFilters();
    const maketitle = filters.find((f) => f.name === '19-maketitle')?.content ?? '';
    expect(maketitle).toContain('\\newcommand*{\\extratitlewidth}{0.75\\textwidth}');
    expect(maketitle).toContain('\\newcommand*{\\dedicationwidth}{0.5\\textwidth}');
    expect(maketitle).toContain('\\newcommand*{\\colophonwidth}{0.75\\textwidth}');
    // Bloque compartido: márgenes y estilo de párrafo como argumentos
    expect(maketitle).toContain('\\newcommand{\\titlepageblock}[4]{%');
    expect(maketitle).toContain('\\leftmargin=#1');
    expect(maketitle).toContain('\\rightmargin=#2');
    // extratitle: márgenes iguales (centrado) y texto centrado; dedication:
    // solo margen izquierdo y texto justificado
    expect(maketitle).toContain('{\\dimexpr(\\linewidth-\\extratitlewidth)/2\\relax}%');
    expect(maketitle).toContain('{\\dimexpr\\linewidth-\\dedicationwidth\\relax}%');
    expect(maketitle).toContain('{\\centering}%');
    expect(maketitle).toContain('\\titlepageblock');
  });

  it('16-toc-styling: BeforeTOCHead, líderes y pagenumberformat en las entradas', async () => {
    const filters = await loadPreambleFilters();
    const toc = filters.find((f) => f.name === '16-toc-styling')?.content ?? '';
    expect(toc).toContain(
      '\\BeforeTOCHead{\\RedeclareSectionCommand[beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}}',
    );
    expect(toc).toContain('linefill=\\TOCLineLeaderFill,beforeskip=\\baselineskip]{tocline}{part}');
    expect(toc).toContain('pagenumberformat=\\normalsize\\normalfont');
    expect(toc).not.toContain('pagenumberbox=\\phantom,indent=0pt,beforeskip=0pt]{tocline}{part}');
  });

  it('29-text-decoration: ulem (subrayado/tachado) y soul (resaltado)', async () => {
    const filters = await loadPreambleFilters();
    const deco = filters.find((f) => f.name === '29-text-decoration')?.content ?? '';
    expect(deco).toContain('\\usepackage[normalem]{ulem}');
    expect(deco).toContain('\\usepackage{soul}');
    expect(deco).toContain('\\sethlcolor{yellow}');
  });

  it('09-tables: contador dummy none para tablas sin caption (pandoc + longtable)', async () => {
    // pandoc envuelve las tablas sin caption en \def\LTcaptype{none} y
    // longtable ejecuta \refstepcounter{none}: sin el contador, falla con
    // 'No counter "none" defined' (la tabla del CV del proyecto de
    // integración rompía el PDF) y hyperref avisaba 'Counter none ...'
    const filters = await loadPreambleFilters();
    const tables = filters.find((f) => f.name === '09-tables')?.content ?? '';
    expect(tables).toContain('\\newcounter{none}');
  });

  it('98-crop: solo marcas de corte (noinfo, sin el texto de información)', async () => {
    const filters = await loadPreambleFilters();
    const crop = filters.find((f) => f.name === '98-crop')?.content ?? '';
    expect(crop).toContain('\\usepackage[width=221.9truemm,height=285.4truemm,center,cam,noinfo]{crop}');
  });

  it('04-margins: headsep y footskip actualizados (headheight = baselineskip)', async () => {
    const filters = await loadPreambleFilters();
    const margins = filters.find((f) => f.name === '04-margins')?.content ?? '';
    expect(margins).toContain('headheight=\\baselineskip,headsep=3.25pt,footskip=10.25pt');
  });

  it('97-eso-pic: el grid se activa en runtime (sin option clash con 30-endpapers)', async () => {
    const filters = await loadPreambleFilters();
    const esopic = filters.find((f) => f.name === '97-eso-pic')?.content ?? '';
    const endpapers = filters.find((f) => f.name === '30-endpapers')?.content ?? '';
    // La cola de imprenta va al final (#1952): 30-endpapers carga eso-pic plano
    // primero y LaTeX fija opciones en el primer \usepackage, así que 97 no puede
    // volver a cargarlo con opciones (option clash, issue #1962). 97 activa el
    // grid en runtime con los mismos parámetros que tenían sus opciones.
    expect(endpapers).toContain('\\usepackage{eso-pic}');
    expect(esopic).not.toContain('\\usepackage[');
    expect(esopic).toContain('\\ESO@gridtrue');
    expect(esopic).toContain('\\ESO@gridBGtrue');
    expect(esopic).toContain('\\ESO@texcoordtrue');
    expect(esopic).toContain('\\ESO@gridcolor{teal!50}');
    expect(esopic).toContain('\\ESO@subgridcolor{teal!30}');
    expect(esopic).toContain('\\g@addto@macro\\ESO@HookIIIBG{\\ESO@gridpicture}');
  });

  it('30-endpapers: imagen de fondo que cubre la hoja (cover recortado al tamaño del papel)', async () => {
    const filters = await loadPreambleFilters();
    const endpapers = filters.find((f) => f.name === '30-endpapers')?.content ?? '';
    expect(endpapers).toContain('\\usepackage{eso-pic}');
    expect(endpapers).toContain('\\AddToShipoutPictureBG*{\\drawendpapers}');
    // Medición a tamaño natural con un sbox (\wd = ancho, \ht = alto)
    expect(endpapers).toContain('\\sbox \\papersbox');
    // Cover recortado: escala y viewport central calculados con l3fp
    expect(endpapers).toContain('\\fp_set:Nn \\l_ep_scale_fp');
    expect(endpapers).toContain('viewport={\\the\\ep@vx}');
    expect(endpapers).toContain('clip,');
    // Sin crop: la imagen mide exactamente el tamaño del papel (sin +6mm)
    expect(endpapers).toContain('width=\\dimexpr\\paperwidth\\relax');
    expect(endpapers).toContain('height=\\dimexpr\\paperheight\\relax');
    // Solo la página 1 Y solo con hojas de guarda (la hoja en blanco antes de
    // la extratitle; sin guardas, el endpaper no se agrega en ningún caso)
    expect(endpapers).toContain('\\ifnum\\value{page}=1');
    expect(endpapers).toContain('\\iftitlepageguards');
    // Cover centrado: el centro de la imagen en el centro de la hoja
    // (el y del put depende del grid de 97-eso-pic, que desplaza el origen)
    expect(endpapers).toContain('\\put(.5\\paperwidth,\\ifx\\ESO@HookIIIBG\\@empty');
    expect(endpapers).toContain('\\vbox to 0pt{%');
    expect(endpapers).toContain('\\hss');
  });
});

describe('crop / pdfx dinámico (#1975)', () => {
  const MM_TO_PT = 2.834639;

  describe('detectPageSize', () => {
    it('detecta paperwidth/paperheight de geometry', () => {
      const filters = [
        { name: '01-documentclass', content: '\\documentclass[paper=letter]{scrbook}' },
        { name: '04-margins', content: '\\usepackage[paperwidth=200mm,paperheight=260mm]{geometry}' },
      ];
      expect(detectPageSize(filters)).toEqual({ w: 200, h: 260 });
    });

    it('detecta paper= de documentclass cuando geometry no define paperwidth', () => {
      const filters = [
        { name: '01-documentclass', content: '\\documentclass[paper=a4]{scrbook}' },
        { name: '04-margins', content: '\\usepackage[top=2.54cm]{geometry}' },
      ];
      expect(detectPageSize(filters)).toEqual({ w: 210, h: 297 });
    });

    it('fallback a letter cuando no hay definición', () => {
      const filters = [{ name: '01-documentclass', content: '\\documentclass{scrbook}' }];
      expect(detectPageSize(filters)).toEqual({ w: 215.9, h: 279.4 });
    });

    it('geometry tiene prioridad sobre documentclass', () => {
      const filters = [
        { name: '01-documentclass', content: '\\documentclass[paper=a4]{scrbook}' },
        { name: '04-margins', content: '\\usepackage[paperwidth=148mm,paperheight=210mm]{geometry}' },
      ];
      expect(detectPageSize(filters)).toEqual({ w: 148, h: 210 });
    });
  });

  describe('buildCropContent', () => {
    it('agrega 6mm a width y height', () => {
      const content = buildCropContent(215.9, 279.4);
      expect(content).toContain('width=221.9truemm,height=285.4truemm');
    });

    it('funciona con a4', () => {
      const content = buildCropContent(210, 297);
      expect(content).toContain('width=216.0truemm,height=303.0truemm');
    });
  });

  describe('buildPdfxPagesattr', () => {
    it('sin crop: las 4 boxes son iguales al tamaño de página en pt', () => {
      const attr = buildPdfxPagesattr(215.9, 279.4, false);
      const w = (215.9 * MM_TO_PT).toFixed(7);
      const h = (279.4 * MM_TO_PT).toFixed(7);
      expect(attr).toContain(`/MediaBox [0 0 ${w} ${h}]`);
      expect(attr).toContain(`/TrimBox [0 0 ${w} ${h}]`);
    });

    it('con crop: MediaBox/CropBox/BleedBox = page+6mm, TrimBox con offset 3mm', () => {
      const attr = buildPdfxPagesattr(215.9, 279.4, true);
      const boxW = ((215.9 + 6) * MM_TO_PT).toFixed(7);
      const boxH = ((279.4 + 6) * MM_TO_PT).toFixed(7);
      const off = (3 * MM_TO_PT).toFixed(6);
      const trimMaxX = ((215.9 + 6) * MM_TO_PT - 3 * MM_TO_PT).toFixed(6);
      const trimMaxY = ((279.4 + 6) * MM_TO_PT - 3 * MM_TO_PT).toFixed(6);
      expect(attr).toContain(`/MediaBox [0 0 ${boxW} ${boxH}]`);
      expect(attr).toContain(`/TrimBox [${off} ${off} ${trimMaxX} ${trimMaxY}]`);
    });
  });

  describe('applyPrintQueueDynamics', () => {
    it('sin crop ni pdfx: no modifica nada', () => {
      const filters = [{ name: '01-documentclass', content: '\\documentclass{scrbook}' }];
      applyPrintQueueDynamics(filters);
      expect(filters[0]?.content).toBe('\\documentclass{scrbook}');
    });

    it('solo crop activo: modifica 98-crop, no toca pdfx', () => {
      const filters = [
        { name: '98-crop', content: 'old' },
        { name: '99-pdfx', content: '\\usepackage[x-1a1]{pdfx}\n\n\\pdfpagesattr{old}' },
      ];
      applyPrintQueueDynamics(filters);
      expect(filters[0]?.content).toContain('width=221.9truemm');
      expect(filters[1]?.content).toContain('\\usepackage[x-1a1]{pdfx}');
    });

    it('solo pdfx activo: no toca crop, genera boxes sin offset', () => {
      const filters = [{ name: '99-pdfx', content: '\\usepackage[x-1a1]{pdfx}\n\n\\pdfpagesattr{old}' }];
      applyPrintQueueDynamics(filters);
      const attr = filters[0]?.content ?? '';
      const w = (215.9 * MM_TO_PT).toFixed(7);
      expect(attr).toContain(`/TrimBox [0 0 ${w}`);
    });

    it('ambos activos: crop + pdfx con boxes de page+6mm y trim offset', () => {
      const filters = [
        { name: '98-crop', content: 'old' },
        { name: '99-pdfx', content: '\\usepackage[x-1a1]{pdfx}\n\n\\pdfpagesattr{old}' },
      ];
      applyPrintQueueDynamics(filters);
      expect(filters[0]?.content).toContain('width=221.9truemm');
      const off = (3 * MM_TO_PT).toFixed(6);
      expect(filters[1]?.content).toContain(`/TrimBox [${off} ${off}`);
    });

    it('crop activo: endpapers agrega +6mm a paperwidth y paperheight', () => {
      const epContent =
        '\\fp_set:Nn \\l_ep_winW_fp { ( \\dim_to_fp:n { \\the\\paperwidth } ) / \\l_ep_scale_fp }\n' +
        'width=\\dimexpr\\paperwidth\\relax,\nheight=\\dimexpr\\paperheight\\relax,';
      const filters = [
        { name: '98-crop', content: 'old' },
        { name: '30-endpapers', content: epContent },
      ];
      applyPrintQueueDynamics(filters);
      const ep = filters[1]?.content ?? '';
      expect(ep).toContain('+ 6mm ) / \\l_ep_scale_fp');
      expect(ep).toContain('width=\\dimexpr\\paperwidth+6mm\\relax');
      expect(ep).toContain('height=\\dimexpr\\paperheight+6mm\\relax');
    });

    it('sin crop: endpapers mide exactamente el tamaño del papel (sin +6mm)', () => {
      const epContent = 'width=\\dimexpr\\paperwidth\\relax,\nheight=\\dimexpr\\paperheight\\relax,';
      const filters = [{ name: '30-endpapers', content: epContent }];
      applyPrintQueueDynamics(filters);
      const ep = filters[0]?.content ?? '';
      expect(ep).toContain('width=\\dimexpr\\paperwidth\\relax');
      expect(ep).not.toContain('+6mm');
    });
  });
});
