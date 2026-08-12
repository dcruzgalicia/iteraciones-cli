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

/** Idiomas ya advertidos (el template se compone una vez por build, pero la conversión corre por documento). */
const warnedLangs = new Set<string>();

/**
 * Resuelve las opciones de babel para un código BCP 47: match exacto, luego
 * idioma base (fr-CA → french) y finalmente español con warning (una vez por
 * idioma: el sink difiere los warnings al resumen del build).
 */
export function babelOptionsForLang(lang: string): string {
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
  lines.push('$if(dedication)$');
  lines.push('\\dedication{$dedication$}');
  lines.push('$endif$');
  lines.push('$if(uppertitleback)$');
  lines.push('\\uppertitleback{$uppertitleback$}');
  lines.push('$endif$');
  lines.push('$if(lowertitleback)$');
  lines.push('\\lowertitleback{$lowertitleback$}');
  lines.push('$endif$');
  lines.push('\\title{$title$}');
  lines.push('$if(subtitle)$');
  lines.push('\\subtitle{$subtitle$}');
  lines.push('$endif$');
  lines.push('\\author{$for(author)$$author$$sep$ \\and $endfor$}');
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
  lines.push('\\end{document}');
  return lines.join('\n');
}
