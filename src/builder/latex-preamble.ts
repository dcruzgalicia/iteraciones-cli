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
import type { PreambleFilter } from './preamble-loader.js';

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
  lines.push('\\vspace*{2\\baselineskip}');
  lines.push('$endif$');
  const pageCommand = PAGE_NUMBER_COMMANDS[opts.pageNumber];
  if (pageCommand) {
    lines.push(pageCommand);
  } else {
    throw new BuildError(`page-number inválido: "${opts.pageNumber}". Valores válidos: ${Object.keys(PAGE_NUMBER_COMMANDS).join(', ')}`);
  }
  lines.push('');
  lines.push('$body$');
  lines.push('');
  lines.push('\\end{document}');
  return lines.join('\n');
}
