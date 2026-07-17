/**
 * Constructor de preámbulo LaTeX compartido entre writeTexFiles y convertToPdf.
 *
 * Dado un PdfFormatConfig y metadatos opcionales (title, author, date),
 * retorna un array de líneas del preámbulo listo para unir con \n.
 * Incluye \begin{document} y \title{}/\author{}/\date{}/\maketitle.
 */
import type { PdfFormatConfig } from '../config/site-config.js';
import { DEFAULT_PDF_FORMAT } from '../config/site-config.js';

export interface PreambleMeta {
  title?: string;
  author?: string[];
  date?: string;
}

export function buildLatexPreamble(pdfFormat?: PdfFormatConfig, meta?: PreambleMeta): string[] {
  const fmt = pdfFormat ?? DEFAULT_PDF_FORMAT;
  const dc = fmt.documentclass ?? 'scrbook';
  const fontSize = fmt.fontSize ?? '12pt';
  const sfdefaults = fmt.sfdefaults ?? false;
  const twoside = fmt.sides === 'twoside';
  const pageSize = fmt.pageSize;
  const geometry = fmt.geometry;
  const fontFamily = fmt.fontFamily ?? 'mathptmx';
  const lineSpacing = fmt.lineSpacing ?? 1.5;

  // Opciones de clase KOMA-Script
  const classOpts = [fontSize];
  classOpts.push(`sfdefaults=${sfdefaults ? 'true' : 'false'}`);
  if (pageSize) {
    if (pageSize === 'half-letter') {
      classOpts.push('paper=13.97cm:21.59cm');
    } else if (pageSize !== 'custom' && !/^\d/.test(pageSize)) {
      classOpts.push(`paper=${pageSize}`);
    }
  }
  if (twoside) classOpts.push('twoside');

  const preamble: string[] = [
    `\\documentclass[${classOpts.join(',')}]{${dc}}`,
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage{textcomp}',
    '\\usepackage{babel}',
    '\\babelprovide[import, main]{mexican}',
    `\\usepackage{${fontFamily}}`,
    '\\usepackage{longtable}',
    '\\usepackage{booktabs}',
    '\\usepackage{array}',
    '\\usepackage{calc}',
    '\\usepackage{setspace}',
    `\\setstretch{${lineSpacing}}`,
    '\\usepackage[activate={true,nocompatibility},final,tracking=true,kerning=true,spacing=true,factor=1100,stretch=10,shrink=10]{microtype}',
    '\\usepackage{hyperref}',
    '\\usepackage{scrlayer-scrpage}',
    '\\clearpairofpagestyles',
    '\\newcounter{none}',
    '\\providecommand{\\tightlist}{%',
    '  \\setlength{\\itemsep}{0pt}\\setlength{\\parskip}{0pt}}',
    '\\raggedbottom',
    '\\pretolerance=200',
    '\\tolerance=400',
    `\\hyphenpenalty=${fmt.hyphenation ? 100 : 1000000}`,
    '\\brokenpenalty=1000000',
    '\\finalhyphendemerits=1000000',
    '\\doublehyphendemerits=1000000',
    '\\widowpenalty=1000000',
    '\\clubpenalty=1000000',
  ];

  // Configurar numeracion de pagina con scrlayer-scrpage
  const pageNum = fmt.pageNumber;
  if (pageNum) {
    const PAGE_NUMBER_MAP: Record<string, string> = {
      'header-right': '\\ohead*{\\pagemark}',
      'header-center': '\\chead*{\\pagemark}',
      'header-left': '\\ihead*{\\pagemark}',
      'footer-right': '\\ofoot*{\\pagemark}',
      'footer-center': '\\cfoot*{\\pagemark}',
      'footer-left': '\\ifoot*{\\pagemark}',
    };
    const cmd = PAGE_NUMBER_MAP[pageNum];
    if (cmd) preamble.push(cmd);
  }

  // Construir opciones de geometry desde el mapa de configuracion
  if (geometry && Object.keys(geometry).length > 0) {
    const geomOpts: string[] = [];
    const order = ['paperwidth', 'paperheight', 'top', 'bottom', 'left', 'right', 'headheight', 'headsep', 'footskip'];
    for (const key of order) {
      const val = geometry[key];
      if (val) geomOpts.push(`${key}=${val}`);
    }
    preamble.push(`\\usepackage[${geomOpts.join(',')}]{geometry}`);
  }

  preamble.push('\\begin{document}');

  if (meta?.title) preamble.push(`\\title{${meta.title}}`);
  if (meta?.author?.length) preamble.push(`\\author{${meta.author.join(' \\and ')}}`);
  if (meta?.date) preamble.push(`\\date{${meta.date}}`);
  if (meta?.title) preamble.push('\\maketitle');

  return preamble;
}
