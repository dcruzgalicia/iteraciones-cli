/**
 * Compositor del template LaTeX efectivo del build.
 *
 * El .tex final (preámbulo + cuerpo) se genera en UNA invocación de pandoc
 * (markdown → latex) usando este template: la configuración estática vive en
 * los archivos .tex bajo src/lib/resources/preamble/ (01-documentclass.tex,
 * 02-fonts.tex, …) y las condiciones estructurales (TOC, espaciado post-
 * portada) las expone el filtro interno internal/flags.lua vía metadata
 * ($if(has-toc-entries)$, $if(skip-paragraph-space)$).
 *
 * El template se compone una vez por build (los preamble filters y la
 * bibliografía no dependen del documento) y se escribe en
 * .iteraciones/templates/latex.tex.
 */
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import type { PreambleFilter } from './preamble-loader.js';

// ── Crop / PDF-X: cálculo dinámico de dimensiones ──────────────────────────

/** Conversión mm → pt (estándar PDF: 1pt = 0.352778mm). */
const MM_TO_PT = 2.834639;

/** Tamaños de papel estándar en mm (ancho × alto). */
const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  letter: { w: 215.9, h: 279.4 },
  a4: { w: 210, h: 297 },
  a5: { w: 148, h: 210 },
  legal: { w: 215.9, h: 355.6 },
  executive: { w: 184.1, h: 266.7 },
  '11x17': { w: 279.4, h: 431.8 },
};

/**
 * Detecta el tamaño de página (mm) a partir de los preamble filters.
 * Orden de prioridad:
 *   1. paperwidth / paperheight en geometry (04-margins)
 *   2. paper= en documentclass (01-documentclass)
 *   3. Fallback: letter
 */
export function detectPageSize(filters: PreambleFilter[]): { w: number; h: number } {
  const margins = filters.find((f) => f.name === '04-margins')?.content ?? '';
  const pwMatch = margins.match(/paperwidth\s*=\s*([\d.]+)\s*mm/);
  const phMatch = margins.match(/paperheight\s*=\s*([\d.]+)\s*mm/);
  const pw = pwMatch?.[1];
  const ph = phMatch?.[1];
  if (pw && ph) {
    return { w: Number.parseFloat(pw), h: Number.parseFloat(ph) };
  }

  const docclass = filters.find((f) => f.name === '01-documentclass')?.content ?? '';
  const paperMatch = docclass.match(/paper\s*=\s*(\w[\w-]*)/);
  const paperKey = paperMatch?.[1];
  if (paperKey) {
    const size = PAPER_SIZES[paperKey.toLowerCase()];
    if (size) return size;
  }

  return { w: 215.9, h: 279.4 };
}

/** Genera el contenido LaTeX del filter 98-crop para un tamaño dado. */
export function buildCropContent(widthMm: number, heightMm: number): string {
  const w = (widthMm + 6).toFixed(1);
  const h = (heightMm + 6).toFixed(1);
  return `% Marcas de corte con crop (desactivado por defecto). noinfo: solo las
% líneas de corte, sin el texto de información ("jobname" — fecha — hora —
% page N — #índice) que este paquete crop imprime por defecto en el área
% de marcas.
\\usepackage[width=${w}truemm,height=${h}truemm,center,cam,noinfo]{crop}`;
}

/** Genera el bloque \\pdfpagesattr del filter 99-pdfx para un tamaño dado. */
export function buildPdfxPagesattr(widthMm: number, heightMm: number, cropActive: boolean): string {
  const boxW = (cropActive ? widthMm + 6 : widthMm) * MM_TO_PT;
  const boxH = (cropActive ? heightMm + 6 : heightMm) * MM_TO_PT;
  const w = boxW.toFixed(7);
  const h = boxH.toFixed(7);

  if (!cropActive) {
    return `\\pdfpagesattr{%
  /MediaBox [0 0 ${w} ${h}]
  /CropBox [0 0 ${w} ${h}]
  /BleedBox [0 0 ${w} ${h}]
  /TrimBox [0 0 ${w} ${h}]
}`;
  }

  const off = (3 * MM_TO_PT).toFixed(6);
  const trimMaxX = (boxW - 3 * MM_TO_PT).toFixed(6);
  const trimMaxY = (boxH - 3 * MM_TO_PT).toFixed(6);
  return `\\pdfpagesattr{%
  /MediaBox [0 0 ${w} ${h}]
  /CropBox [0 0 ${w} ${h}]
  /BleedBox [0 0 ${w} ${h}]
  /TrimBox [${off} ${off} ${trimMaxX} ${trimMaxY}]
}`;
}

/**
 * Aplica generación dinámica a los filters de la cola de imprenta (98-crop,
 * 99-pdfx) y a 30-endpapers según el tamaño de página detectado y qué
 * filters están activos. Modifica el array in-place y retorna el mismo
 * puntero para encadenamiento.
 */
export function applyPrintQueueDynamics(filters: PreambleFilter[]): PreambleFilter[] {
  const cropActive = filters.some((f) => f.name === '98-crop');
  const pdfxActive = filters.some((f) => f.name === '99-pdfx');
  if (!cropActive && !pdfxActive) return filters;

  const { w, h } = detectPageSize(filters);

  for (const f of filters) {
    if (f.name === '98-crop' && cropActive) {
      f.content = buildCropContent(w, h);
    } else if (f.name === '99-pdfx' && pdfxActive) {
      const pkgLine = f.content.match(/^(\\usepackage\[.*?\]\{pdfx\})/m)?.[0] ?? '\\usepackage[x-1a1]{pdfx}';
      const pagesattr = buildPdfxPagesattr(w, h, cropActive);
      f.content = `${pkgLine}\n\n${pagesattr}`;
    }
  }

  // Endpapers: cuando crop está activo, la imagen necesita +6mm (3mm por
  // lado) para cubrir el stock más grande de las marcas de corte.
  if (cropActive) {
    const ep = filters.find((f) => f.name === '30-endpapers');
    if (ep) {
      ep.content = ep.content
        .replaceAll(') / \\dim_to_fp:n { \\the\\wd\\papersbox', '+ 6mm ) / \\dim_to_fp:n { \\the\\wd\\papersbox')
        .replaceAll(') / \\dim_to_fp:n { \\the\\ht\\papersbox', '+ 6mm ) / \\dim_to_fp:n { \\the\\ht\\papersbox')
        .replaceAll(') / \\l_ep_scale_fp', '+ 6mm ) / \\l_ep_scale_fp')
        .replaceAll('width=\\dimexpr\\paperwidth\\relax', 'width=\\dimexpr\\paperwidth+6mm\\relax')
        .replaceAll('height=\\dimexpr\\paperheight\\relax', 'height=\\dimexpr\\paperheight+6mm\\relax');
    }
  }

  return filters;
}

/**
 * Opciones de babel por código BCP 47 (lang de configuración).
 * Las variantes de español conservan las opciones históricas del paquete
 * (es-noshorthands, es-noindentfirst y mexico para es-MX).
 */
const BABEL_LANG_OPTIONS: Record<string, string> = {
  es: 'spanish,es-noshorthands,es-noindentfirst',
  'es-MX': 'spanish,mexico,es-noshorthands,es-noindentfirst',
  'es-ES': 'spanish,es-noshorthands,es-noindentfirst',
  en: 'english',
  'en-US': 'english',
  'en-GB': 'english',
  fr: 'french',
  de: 'german',
  it: 'italian',
  pt: 'portuguese',
  'pt-BR': 'brazilian',
  ca: 'catalan',
  eu: 'basque',
  gl: 'galician',
  nl: 'dutch',
  ru: 'russian',
};

/**
 * Resuelve las opciones de babel para un código BCP 47: match exacto, luego
 * idioma base (fr-CA → french) y finalmente español con warning. `warnedLangs`
 * es el registro del build (una vez por build, no por proceso): la API
 * programática documentada permite llamadas repetidas a build() en el mismo
 * proceso sin suprimir warnings entre llamadas.
 */
export function babelOptionsForLang(lang: string, warnedLangs: Set<string>): string {
  const direct = BABEL_LANG_OPTIONS[lang];
  if (direct) return direct;
  const base = lang.split('-')[0] ?? '';
  const byBase = BABEL_LANG_OPTIONS[base];
  if (byBase) return byBase;
  if (!warnedLangs.has(lang)) {
    warnedLangs.add(lang);
    logWarning(`lang "${lang}" sin opciones babel conocidas; se usa español por defecto`, 'latex');
  }
  return BABEL_LANG_OPTIONS.es ?? 'spanish';
}

/**
 * Escapa los caracteres que romperían el parseo TeX en rutas de archivo
 * (\addbibresource): % inicia un comentario y # es un carácter de parámetro.
 * No escapa _ ni ~ porque biblatex usa la ruta literalmente y el escape
 * rompería nombres de archivo comunes (p. ej. mi_bibliografia.bib).
 */
function escapeLatexPath(s: string): string {
  return s.replace(/([%#\\])/g, '\\$1');
}

/** Comandos scrlayer-scrpage por posición del número de página. */
const PAGE_NUMBER_COMMANDS: Record<string, string> = {
  'header-left': '\\ihead*{\\pagemark}',
  'header-center': '\\chead*{\\pagemark}',
  'header-right': '\\ohead*{\\pagemark}',
  'footer-left': '\\ifoot*{\\pagemark}',
  'footer-center': '\\cfoot*{\\pagemark}',
  'footer-right': '\\ofoot*{\\pagemark}',
};

/** Comando de página para una posición configurada (o undefined si es inválida). */
export function pageNumberCommandFor(pageNumber: string): string | undefined {
  return PAGE_NUMBER_COMMANDS[pageNumber];
}

/**
 * Compone el template LaTeX efectivo del build:
 *   preamble filters (01-23…) → \addbibresource → \begin{document} →
 *   \title/\subtitle/\author/\date/\maketitle → \tableofcontents (condicional
 *   por $if(has-toc-entries)$) → espaciado post-portada (condicional por
 *   $if(skip-paragraph-space)$) → número de página → $body$ → \end{document}.
 *
 * Los condicionales ocupan líneas completas: un $if$ en línea propia no deja
 * líneas en blanco en el .tex cuando es falso (a diferencia del $if$ inline).
 */
export async function composeLatexTemplate(opts: {
  pageNumber: string;
  toc: boolean;
  preambleFilters: PreambleFilter[];
  bibFiles: string[];
}): Promise<string> {
  const lines: string[] = [];
  for (const filter of opts.preambleFilters) {
    lines.push(filter.content.trimEnd());
  }
  for (const bib of opts.bibFiles) {
    lines.push(`\\addbibresource{${escapeLatexPath(bib)}}`);
  }
  lines.push('\\begin{document}');
  // Sin \pagestyle{empty} explícito: \clearpairofpagestyles (06-headers.tex)
  // ya deja los layers vacíos, así que portada/TOC no muestran nada hasta que
  // el comando de página se define (el pagestyle default headings los usa).
  // Páginas de título internas (frontmatter multilinea → LaTeX por el filter
  // 10-titlepages): los comandos solo guardan con \gdef; 19-maketitle.tex
  // los renderiza en el orden KOMA (extratitle → portada → titlebacks → dedication).
  lines.push('$if(extratitle)$');
  lines.push('\\extratitle{$extratitle$}');
  lines.push('$endif$');
  lines.push('$if(frontispiece)$');
  lines.push('\\frontispiece{$frontispiece$}');
  lines.push('$endif$');
  lines.push('$if(titlehead)$');
  lines.push('\\titlehead{$titlehead$}');
  lines.push('$endif$');
  lines.push('$if(subject)$');
  lines.push('\\subject{$subject$}');
  lines.push('$endif$');
  lines.push('$if(dedication)$');
  lines.push('\\dedication{$dedication$}');
  lines.push('$endif$');
  lines.push('$if(uppertitleback)$');
  lines.push('\\uppertitleback{$uppertitleback$}');
  lines.push('$endif$');
  lines.push('$if(lowertitleback)$');
  lines.push('\\lowertitleback{$lowertitleback$}');
  lines.push('$endif$');
  lines.push('$if(publishers)$');
  lines.push('\\publishers{$publishers$}');
  lines.push('$endif$');
  lines.push('$if(publishers-image)$');
  // publishers-image (solo LaTeX/PDF): el filter 10-titlepages la convierte a
  // RawInline latex (ruta literal); 19-maketitle.tex renderiza la imagen en
  // lugar del texto de publishers.
  lines.push('\\publishersimage{$publishers-image$}');
  lines.push('$endif$');
  lines.push('$if(endpapers)$');
  // endpapers (solo LaTeX/PDF): imagen de fondo de todas las páginas
  // (30-endpapers.tex la mide con pdfximage y cubre la hoja).
  lines.push('\\setendpapers{$endpapers$}');
  lines.push('$endif$');
  lines.push('\\title{$title$}');
  lines.push('$if(title-image)$');
  // title-image (solo LaTeX/PDF): el filter 10-titlepages la convierte a
  // RawInline latex (ruta literal, sin escapes); 19-maketitle.tex renderiza
  // la imagen en lugar del texto del título.
  lines.push('\\titleimage{$title-image$}');
  lines.push('$endif$');
  lines.push('$if(subtitle)$');
  lines.push('\\subtitle{$subtitle$}');
  lines.push('$endif$');
  lines.push('\\author{$for(creator)$\\mbox{$creator$}$sep$ \\and $endfor$}');
  lines.push('\\date{$date$}');
  lines.push('\\maketitle');
  if (opts.toc) {
    lines.push('$if(has-toc-entries)$');
    lines.push('\\tableofcontents');
    lines.push('$endif$');
  }
  lines.push('$if(skip-paragraph-space)$');
  lines.push('$else$');
  // El vspace separa la portada/TOC del contenido cuando este empieza pegado
  // en la misma página (párrafo normal). Con titlebacks el body puede empezar
  // en página nueva o compartir la página de los titlebacks: en ambos casos
  // el criterio es el mismo — solo skip-paragraph-space decide.
  lines.push('\\vspace*{2\\baselineskip}');
  lines.push('$endif$');
  const pageCommand = PAGE_NUMBER_COMMANDS[opts.pageNumber];
  if (pageCommand) {
    // Activar la numeración: el pagestyle default (headings) ya muestra los
    // layers de scrlayer-scrpage y los comandos con * (\ohead*{\pagemark}, ...)
    // aplican también a plain. Si el primer bloque del body es un
    // title/list-opener (skip-paragraph-space), el comando lo inserta
    // flags.lua DESPUÉS de ese bloque (la numeración empieza con el
    // contenido); con un párrafo normal, se emite aquí (antes del body) y la
    // última página de la portada/TOC comparte la numeración con el primer
    // párrafo.
    lines.push('$if(skip-paragraph-space)$');
    lines.push('$else$');
    lines.push(pageCommand);
    lines.push('$endif$');
  } else {
    throw new BuildError(`page-number inválido: "${opts.pageNumber}". Valores válidos: ${Object.keys(PAGE_NUMBER_COMMANDS).join(', ')}`);
  }
  lines.push('');
  lines.push('$body$');
  lines.push('');
  lines.push('$if(colophon)$');
  // Colofón final: 28-titlepages.tex define \colophon (guarda el contenido
  // serializado por 10-titlepages) y \colophonpage (siempre en una página
  // par, la última del documento). Va después del body, así que queda
  // incluso después de \printbibliography (inyectado al AST por flags.lua).
  lines.push('\\colophon{$colophon$}');
  lines.push('\\colophonpage');
  lines.push('$endif$');
  lines.push('');
  lines.push('\\end{document}');
  return lines.join('\n');
}
