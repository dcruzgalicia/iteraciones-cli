/**
 * Constructor de preámbulo LaTeX compartido entre writeTexFiles y convertToPdf.
 *
 * La configuración estática de paquetes LaTeX vive en archivos .tex bajo
 * src/lib/resources/preamble/ (01-documentclass.tex, 02-fonts.tex, …).
 * Esta función solo compone la parte dinámica: metadatos del documento,
 * tabla de contenidos condicional, bibliografía con rutas del proyecto,
 * y espaciado post-portada.
 *
 * Orden de composición:
 *   preamble filters (01-25) → \begin{document} → \title/\author/\date/\maketitle
 *   → \tableofcontents (condicional) → espaciado post-portada
 */
import type { PdfFormatConfig, SiteConfig } from '../config/site-config.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { loadPreambleFilters, type PreambleFilter } from './preamble-loader.js';
import { discoverBibFiles } from './state.js';
import type { PreambleFlags } from './types.js';

/**
 * Escapa caracteres especiales de LaTeX en texto de metadatos (títulos,
 * autores). Es el mismo conjunto de caracteres que escape_latex de los
 * filtros Lua de la capa latex (src/lib/resources/filters/latex/).
 */
function escapeLatex(s: string): string {
  const BS = '\u0001'; // placeholder para el backslash (evita re-escapar \textbackslash{})
  return s
    .replace(/\\/g, BS)
    .replace(/([{}#$&_%])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
    .replaceAll(BS, '\\textbackslash{}');
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

interface PreambleMeta {
  title?: string;
  subtitle?: string;
  author?: string[];
  date?: string;
  filePath?: string;
  showDate?: boolean;
  /** Directorio raiz del proyecto para descubrir archivos .bib. */
  cwd?: string;
  /** Ruta absoluta de la bibliografía efectiva (configurada o auto-descubierta). */
  bibliography?: string;
  /** Si el cuerpo LaTeX contiene encabezados (section, chapter, etc.). */
  hasTocEntries?: boolean;
  /** Si el primer bloque del cuerpo LaTeX es un encabezado o dictum (true) o un parrafo (false). */
  skipNoIndent?: boolean;
  /** Si el primer bloque del cuerpo LaTeX es solo un parrafo (no heading, no dictum). */
  skipParagraphSpace?: boolean;
}

export async function buildLatexPreamble(
  pdfFormat?: PdfFormatConfig,
  meta?: PreambleMeta,
  disabledPreambleFilters?: string[],
  toc?: boolean,
  preambleFilters?: PreambleFilter[],
  bibFiles?: string[],
): Promise<string[]> {
  const preamble: string[] = [];

  // ── Preamble filters (archivos .tex en orden, con override del proyecto) ──
  // Se resuelven una sola vez por build en el pipeline y se pasan aquí.
  const cwdForFilters = meta?.cwd;
  const effectiveFilters = preambleFilters ?? (await loadPreambleFilters(disabledPreambleFilters, cwdForFilters));
  for (const filter of effectiveFilters) {
    preamble.push(filter.content.trimEnd());
  }

  // ── Bibliografía (rutas .bib dinámicas desde el proyecto) ──
  // Con bibliografía efectiva (configurada o auto-descubierta por el pipeline)
  // se referencia esa ruta; sin ella, se descubren los .bib del proyecto.
  if (meta?.bibliography || cwdForFilters) {
    const effectiveBibFiles = bibFiles ?? (meta?.bibliography ? [meta.bibliography] : await discoverBibFiles(cwdForFilters ?? '', ['bib']));
    if (effectiveBibFiles.length > 0) {
      for (const bib of effectiveBibFiles) {
        preamble.push(`\\addbibresource{${escapeLatexPath(bib)}}`);
      }
    }
  }

  // ── CUERPO DEL DOCUMENTO ──
  preamble.push('\\begin{document}');

  // ── PORTADA ──
  const displayTitle = escapeLatex(meta?.title || 'Sin t\u00edtulo');
  preamble.push(`\\title{${displayTitle}}`);
  if (meta?.subtitle) preamble.push(`\\subtitle{${escapeLatex(meta.subtitle)}}`);
  // Se emite siempre (vacío sin author) para que \ifx\@author\@empty en
  // 19-maketitle.tex sea verdadero y el título mantenga su posición:
  // si \author{} no se llama, \@author es una macro de warning de LaTeX
  // que deja la rama de compensación sin efecto.
  const authors = meta?.author?.map((a) => escapeLatex(a)).join(' \\and ') ?? '';
  preamble.push(`\\author{${authors}}`);
  if (pdfFormat?.showDate) {
    if (meta?.date) {
      preamble.push(`\\date{${formatHumanDate(meta.date)}}`);
    } else if (meta?.filePath) {
      try {
        const fileStat = await Bun.file(meta.filePath).stat();
        const btime = fileStat.birthtime || fileStat.mtime;
        if (btime) {
          const y = btime.getFullYear();
          const m = String(btime.getMonth() + 1).padStart(2, '0');
          const d = String(btime.getDate()).padStart(2, '0');
          preamble.push(`\\date{${formatHumanDate(`${y}-${m}-${d}`)}}`);
        }
      } catch {
        // Si no se puede leer el archivo, no agregar fecha
      }
    }
  } else {
    preamble.push('\\date{}');
  }
  preamble.push('\\maketitle');

  // ── TABLA DE CONTENIDOS ──
  if (toc && meta?.hasTocEntries) {
    preamble.push('\\tableofcontents');
  }

  // ── ESPACIO TRAS PORTADA/INDICE ──
  if (!meta?.skipParagraphSpace) {
    preamble.push('\\vspace*{2\\baselineskip}');
  }

  // ── NÚMERO DE PÁGINA ──
  // Se aplica en el cuerpo, después de maketitle/TOC, para no afectar
  // la portada ni el índice (que usan \thispagestyle{empty}).
  const pageNumber = pdfFormat?.pageNumber ?? 'header-right';
  const pageCommand = PAGE_NUMBER_COMMANDS[pageNumber];
  if (pageCommand) {
    preamble.push(pageCommand);
  } else {
    throw new BuildError(`page-number inválido: "${pageNumber}". Valores válidos: ${Object.keys(PAGE_NUMBER_COMMANDS).join(', ')}`);
  }

  return preamble;
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

// ── Composición del documento .tex completo ─────────────────────────────────

/**
 * Compone el documento .tex completo (preámbulo + cuerpo) para un documento,
 * a partir del cuerpo LaTeX y los flags de preámbulo calculados del AST.
 * Si el primer bloque es un párrafo, antepone \\noindent.
 */
export async function composeFullTex(
  siteConfig: SiteConfig,
  meta: PreambleMeta,
  texBody: string,
  flags: PreambleFlags,
  preambleFilters?: PreambleFilter[],
  bibFiles?: string[],
): Promise<string> {
  let body = texBody.replace(/\n+$/, '');
  if (!flags.skipNoIndent) {
    body = `\\noindent ${body.trimStart()}`;
  }
  const preamble = await buildLatexPreamble(
    siteConfig.format?.pdf,
    { ...meta, hasTocEntries: flags.hasTocEntries, skipNoIndent: flags.skipNoIndent, skipParagraphSpace: flags.skipParagraphSpace },
    siteConfig.format?.pdf?.disabledPreambleFilters,
    siteConfig.toc,
    preambleFilters,
    bibFiles,
  );
  return [...preamble, '', body, '', '\\end{document}'].join('\n');
}
