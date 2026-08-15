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
    // Centrado vertical con vbox to textheight: el \vspace*{\fill} entre
    // bloques dejaba el contenido fuera del centro (page builder + strut)
    expect(maketitle).toContain('\\vbox to \\textheight{%');
    expect(maketitle).toContain('\\vfill');
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
    expect(subject).toBeLessThan(head);
    expect(head).toBeLessThan(date);
    expect(date).toBeLessThan(pub);
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
      '\\BeforeTOCHead{\\RedeclareSectionCommand[beforeskip=4\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}}',
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

  it('30-endpapers: imagen de fondo que cubre la hoja (lado más corto + 6mm)', async () => {
    const filters = await loadPreambleFilters();
    const endpapers = filters.find((f) => f.name === '30-endpapers')?.content ?? '';
    expect(endpapers).toContain('\\usepackage{eso-pic}');
    expect(endpapers).toContain('\\AddToShipoutPictureBG*{\\drawendpapers}');
    // Medición a tamaño natural con un sbox (\wd = ancho, \ht = alto)
    expect(endpapers).toContain('\\sbox{\\papersbox}{\\includegraphics{#1}}');
    // Solo la página 1 Y solo con hojas de guarda (la hoja en blanco antes de
    // la extratitle; sin guardas, el endpaper no se agrega en ningún caso)
    expect(endpapers).toContain('\\ifnum\\value{page}=1');
    expect(endpapers).toContain('\\iftitlepageguards');
    // Lado más corto decide la dimensión fija: papel + 6mm (paperwidth o
    // paperheight reales de documentclass/geometry, no hardcodeados)
    expect(endpapers).toContain('\\ifdim\\wd\\papersbox<\\ht\\papersbox');
    expect(endpapers).toContain('width=\\dimexpr\\paperwidth+6mm\\relax,keepaspectratio');
    expect(endpapers).toContain('height=\\dimexpr\\paperheight+6mm\\relax,keepaspectratio');
  });
});
