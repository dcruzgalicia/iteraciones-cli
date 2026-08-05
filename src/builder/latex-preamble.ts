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
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { PdfFormatConfig, SiteConfig } from '../config/site-config.js';
import { loadPreambleFilters } from './preamble-loader.js';
import { discoverBibFiles } from './state.js';
import type { DiscoveryEntry } from './types.js';

export interface PreambleMeta {
  title?: string;
  subtitle?: string;
  author?: string[];
  date?: string;
  filePath?: string;
  showDate?: boolean;
  /** Directorio raiz del proyecto para descubrir archivos .bib. */
  cwd?: string;
  /** Si el cuerpo LaTeX contiene encabezados (section, chapter, etc.). */
  hasTocEntries?: boolean;
  /** Si el primer bloque del cuerpo LaTeX es un encabezado o dictum (true) o un parrafo (false). */
  skipNoIndent?: boolean;
  /** Si el primer bloque del cuerpo LaTeX es solo un parrafo (no heading, no dictum). */
  skipParagraphSpace?: boolean;
}

export async function buildLatexPreamble(pdfFormat?: PdfFormatConfig, meta?: PreambleMeta, disabledPreambleFilters?: string[]): Promise<string[]> {
  const preamble: string[] = [];

  // ── Preamble filters (archivos .tex en orden, con override del proyecto) ──
  const cwdForFilters = meta?.cwd;
  const preambleFilters = await loadPreambleFilters(disabledPreambleFilters, cwdForFilters);
  for (const filter of preambleFilters) {
    preamble.push(filter.content.trimEnd());
  }

  // ── Bibliografía (rutas .bib dinámicas desde el proyecto) ──
  if (cwdForFilters) {
    const bibFiles = discoverBibFiles(cwdForFilters, ['bib']);
    if (bibFiles.length > 0) {
      for (const bib of bibFiles) {
        preamble.push(`\\addbibresource{${bib}}`);
      }
    }
  }

  // ── CUERPO DEL DOCUMENTO ──
  preamble.push('\\begin{document}');

  // ── PORTADA ──
  const displayTitle = meta?.title || 'Sin t\u00edtulo';
  preamble.push(`\\title{${displayTitle}}`);
  if (meta?.subtitle) preamble.push(`\\subtitle{${meta.subtitle}}`);
  // Se emite siempre (vacío sin author) para que \ifx\@author\@empty en
  // 19-maketitle-patches.tex sea verdadero y el título mantenga su posición:
  // si \author{} no se llama, \@author es una macro de warning de LaTeX
  // que deja la rama de compensación sin efecto.
  preamble.push(`\\author{${meta?.author?.length ? meta.author.join(' \\and ') : ''}}`);
  if (pdfFormat?.showDate) {
    if (meta?.date) {
      preamble.push(`\\date{${meta.date}}`);
    } else if (meta?.filePath) {
      try {
        const fileStat = await Bun.file(meta.filePath).stat();
        const btime = fileStat.birthtime || fileStat.mtime;
        if (btime) {
          const y = btime.getFullYear();
          const m = String(btime.getMonth() + 1).padStart(2, '0');
          const d = String(btime.getDate()).padStart(2, '0');
          preamble.push(`\\date{${y}-${m}-${d}}`);
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
  if (pdfFormat?.toc && meta?.hasTocEntries) {
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
    throw new Error(`page-number inválido: "${pageNumber}". Valores válidos: ${Object.keys(PAGE_NUMBER_COMMANDS).join(', ')}`);
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

// ── Generador de preámbulo completo ─────────────────────────────────────────

/**
 * Genera el archivo .tex completo (preámbulo + cuerpo) para cada documento
 * reciente en el caché. Lee el cuerpo desde `.iteraciones/tex/` y los flags
 * desde `.iteraciones/tex/*.flags.json`, y escribe el resultado en
 * `.iteraciones/formats/pdf/`.
 */
export async function generateLatexPreamble(
  cwd: string,
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
  recentFiles: string[],
): Promise<void> {
  const pdfActive = siteConfig.format?.pdf?.generate === true || siteConfig.format?.latex === true;
  if (!pdfActive) return;
  const cacheBase = join(cwd, '.iteraciones');
  for (const relPath of recentFiles) {
    const entry = discoveryIndex.get(relPath);
    if (!entry) continue;
    const slug = entry.slug ?? basename(relPath, '.md');
    const dir = dirname(relPath);
    const texBodyPath = join(cacheBase, 'tex', dir, `${slug}.tex`);
    let texBody: string;
    try {
      texBody = await Bun.file(texBodyPath).text();
      texBody = texBody.replace(/\n+$/, '');
    } catch {
      continue;
    }
    // Flags de preámbulo: desde flags.json (calculados del AST en render.ts).
    // El fallback por regex (detectFlagsFromLatex) se eliminó: writeCachedArtifacts
    // escribe el .tex y flags.json juntos, así que si el body existe, los flags
    // deben existir. Un flags.json ausente o inválido es un estado inconsistente
    // del caché y el build debe fallar con un error claro.
    const flagsPath = join(cacheBase, 'tex', dir, `${slug}.flags.json`);
    let flags: { hasTocEntries: boolean; skipNoIndent: boolean; skipParagraphSpace: boolean };
    try {
      flags = JSON.parse(await Bun.file(flagsPath).text()) as typeof flags;
    } catch (err) {
      throw new Error(`flags.json no encontrado o inválido para "${relPath}" (${flagsPath}): ${String(err)}`);
    }
    const { hasTocEntries, skipNoIndent, skipParagraphSpace } = flags;
    // Si el primer bloque es un parrafo, anteponer \noindent
    if (!skipNoIndent) {
      texBody = '\\noindent ' + texBody.trimStart();
    }
    const preamble = await buildLatexPreamble(
      siteConfig.format?.pdf,
      {
        title: entry.title,
        subtitle: entry.subtitle,
        author: entry.author,
        date: entry.date,
        filePath: join(cwd, relPath),
        cwd,
        hasTocEntries,
        skipNoIndent,
        skipParagraphSpace,
      },
      siteConfig.disabledPreambleFilters,
    );
    const fullTex = [...preamble, '', texBody, '', '\\end{document}'].join('\n');
    const pdfDir = join(cacheBase, 'formats', 'pdf', dir);
    await mkdir(pdfDir, { recursive: true });
    await Bun.write(join(pdfDir, `${slug}.tex`), fullTex);
  }
}
