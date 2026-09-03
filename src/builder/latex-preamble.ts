import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import type { PreambleFilter } from './preamble-loader.js';

const MM_TO_PT = 2.834639;

const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  letter: { w: 215.9, h: 279.4 },
  a4: { w: 210, h: 297 },
  a5: { w: 148, h: 210 },
  legal: { w: 215.9, h: 355.6 },
  executive: { w: 184.1, h: 266.7 },
  '11x17': { w: 279.4, h: 431.8 },
};

export function detectPageSize(filters: PreambleFilter[]): { w: number; h: number; textW: number } {
  const margins = filters.find((f) => f.name === '04-margins')?.content ?? '';
  const pwMatch = margins.match(/paperwidth\s*=\s*([\d.]+)\s*mm/);
  const phMatch = margins.match(/paperheight\s*=\s*([\d.]+)\s*mm/);
  const leftMatch = margins.match(/left\s*=\s*([\d.]+)\s*(mm|cm|pt)/);
  const rightMatch = margins.match(/right\s*=\s*([\d.]+)\s*(mm|cm|pt)/);
  const pw = pwMatch?.[1];
  const ph = phMatch?.[1];
  if (pw && ph) {
    const pwMm = Number.parseFloat(pw);
    const phMm = Number.parseFloat(ph);
    const leftMm = leftMatch ? parseMarginMm(leftMatch[1], leftMatch[2]) : 25.4;
    const rightMm = rightMatch ? parseMarginMm(rightMatch[1], rightMatch[2]) : 25.4;
    const textW = pwMm - leftMm - rightMm;
    return { w: pwMm, h: phMm, textW };
  }

  const docclass = filters.find((f) => f.name === '01-documentclass')?.content ?? '';
  const paperMatch = docclass.match(/paper\s*=\s*(\w[\w-]*)/);
  const paperKey = paperMatch?.[1];
  if (paperKey) {
    const size = PAPER_SIZES[paperKey.toLowerCase()];
    if (size) {
      return { w: size.w, h: size.h, textW: size.w - 50.8 };
    }
  }

  return { w: 215.9, h: 279.4, textW: 165.1 };
}

function parseMarginMm(value: string | undefined, unit: string | undefined): number {
  if (!value || !unit) return 25.4;
  const v = Number.parseFloat(value);
  switch (unit) {
    case 'mm':
      return v;
    case 'cm':
      return v * 10;
    case 'pt':
      return v * 0.352778;
    default:
      return 25.4;
  }
}

export function buildCropContent(widthMm: number, heightMm: number): string {
  const w = (widthMm + 6).toFixed(1);
  const h = (heightMm + 6).toFixed(1);
  return `% Marcas de corte con crop (desactivado por defecto). noinfo: solo las
% líneas de corte, sin el texto de información ("jobname" — fecha — hora —
% page N — #índice) que este paquete crop imprime por defecto en el área
% de marcas.
\\usepackage[width=${w}truemm,height=${h}truemm,center,cam,noinfo]{crop}`;
}

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

export function applyPrintQueueDynamics(filters: PreambleFilter[], pageDimensions?: { w: number; h: number; textW: number }): PreambleFilter[] {
  const cropActive = filters.some((f) => f.name === '98-crop');
  const pdfxActive = filters.some((f) => f.name === '99-pdfx');
  if (!cropActive && !pdfxActive) return filters;

  const { w, h } = pageDimensions ?? detectPageSize(filters);

  for (const f of filters) {
    if (f.name === '98-crop' && cropActive) {
      f.content = buildCropContent(w, h);
    } else if (f.name === '99-pdfx' && pdfxActive) {
      const pkgLine = f.content.match(/^(\\usepackage\[.*?\]\{pdfx\})/m)?.[0] ?? '\\usepackage[x-1a1]{pdfx}';
      const pagesattr = buildPdfxPagesattr(w, h, cropActive);
      f.content = `${pkgLine}\n\n${pagesattr}`;
    }
  }

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

function escapeLatexPath(s: string): string {
  return s.replace(/([%#\\])/g, '\\$1');
}

const PAGE_NUMBER_COMMANDS: Record<string, string> = {
  'header-left': '\\ihead*{\\pagemark}',
  'header-center': '\\chead*{\\pagemark}',
  'header-right': '\\ohead*{\\pagemark}',
  'footer-left': '\\ifoot*{\\pagemark}',
  'footer-center': '\\cfoot*{\\pagemark}',
  'footer-right': '\\ofoot*{\\pagemark}',
};

export function pageNumberCommandFor(pageNumber: string): string | undefined {
  return PAGE_NUMBER_COMMANDS[pageNumber];
}

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
  lines.push('$if(publisher-image)$');
  lines.push('\\publishersimage{$publisher-image$}');
  lines.push('$endif$');
  lines.push('$if(endpapers)$');
  lines.push('\\setendpapers{$endpapers$}');
  lines.push('$endif$');
  lines.push('$if(courtesy-page)$');
  lines.push('\\courtepagetrue');
  lines.push('$endif$');
  lines.push('\\title{$title$}');
  lines.push('$if(title-image)$');
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
  lines.push('\\vspace*{2\\baselineskip}');
  lines.push('$endif$');
  const pageCommand = PAGE_NUMBER_COMMANDS[opts.pageNumber];
  if (pageCommand) {
    lines.push('$if(skip-paragraph-space)$');
    lines.push('$else$');
    lines.push(pageCommand);
    lines.push('$endif$');
  } else {
    throw new BuildError(`pageNumber inválido: "${opts.pageNumber}". Valores válidos: ${Object.keys(PAGE_NUMBER_COMMANDS).join(', ')}`);
  }
  lines.push('');
  lines.push('$body$');
  lines.push('');
  lines.push('$if(colophon)$');
  lines.push('\\colophon{$colophon$}');
  lines.push('\\colophonpage');
  lines.push('$endif$');
  lines.push('');
  lines.push('\\end{document}');
  return lines.join('\n');
}
