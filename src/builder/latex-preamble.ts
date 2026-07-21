/**
 * Constructor de preámbulo LaTeX compartido entre writeTexFiles y convertToPdf.
 *
 * Dado un PdfFormatConfig y metadatos opcionales (title, author, date),
 * retorna un array de líneas del preámbulo listo para unir con \n.
 * Incluye \begin{document} y \title{}/\author{}/\date{}/\maketitle.
 *
 * El orden de los paquetes y comandos sigue la tabla:
 *   CLASE → CORE → FUENTE → INTERLINEADO → MÁRGENES → IDIOMA →
 *   ENCABEZADOS → TIPOGRAFÍA → COMPOSICIÓN → ENLACES → TABLAS →
 *   LISTAS → BIBLIOGRAFÍA → EXTRAS → CONTADORES →
 *   (transpilers) → \begin{document} → \title/\author/\date/\maketitle → \tableofcontents
 */
import type { PdfFormatConfig } from '../config/site-config.js';
import { DEFAULT_PDF_FORMAT } from '../config/site-config.js';
import { loadPreambleTranspilers } from './preamble-loader.js';

/** Mapa de nombres de page-size a dimensiones [ancho, alto] en mm. */
const PAGE_SIZE_DIMS: Record<string, [number, number]> = {
  'half-letter': [139.7, 215.9],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  executive: [184.15, 266.7],
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  b4: [250, 353],
  b5: [176, 250],
  tabloid: [279.4, 431.8],
  pocket: [105, 176],
};

export interface PreambleMeta {
  title?: string;
  author?: string[];
  date?: string;
  filePath?: string;
  showDate?: boolean;
  /** Directorio raiz del proyecto para descubrir archivos .bib. */
  cwd?: string;
}

/** Descubre archivos .bib en el proyecto (excluye node_modules, .iteraciones, dist). */
function discoverBibFiles(cwd: string): string[] {
  const results: string[] = [];
  try {
    const glob = new Bun.Glob('**/*.bib');
    for (const file of glob.scanSync({ cwd, absolute: true })) {
      const rel = file.replace(cwd, '').replace(/^\/+/, '');
      if (rel.startsWith('node_modules/') || rel.startsWith('.iteraciones/') || rel.startsWith('dist/') || rel.startsWith('.git/')) continue;
      results.push(file);
    }
  } catch {
    // Si falla el escaneo, continuar sin archivos .bib
  }
  return results.sort();
}

export async function buildLatexPreamble(
  pdfFormat?: PdfFormatConfig,
  meta?: PreambleMeta,
  disabledPreambleTranspilers?: string[],
): Promise<string[]> {
  const fmt = pdfFormat ?? DEFAULT_PDF_FORMAT;
  const dc = fmt.documentclass?.class ?? 'scrbook';
  const fontSize = fmt.documentclass?.options?.find((o) => /^\d+pt$/.test(o)) ?? '12pt';
  const sfdefaults = fmt.documentclass?.options?.includes('sfdefaults=true') ?? false;
  const twoside = fmt.documentclass?.options?.includes('twoside') ?? false;
  const pageSizeOption = fmt.documentclass?.options?.find((o) => o.startsWith('paper='));
  const pageSize = pageSizeOption ? pageSizeOption.replace('paper=', '') : undefined;
  const geometry = fmt.geometry;
  const fontFamily = fmt.fontFamily ?? 'mathptmx';
  const lineSpacing = fmt.setstretch ?? 1.5;

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

  const preamble: string[] = [];

  // ── 1. CLASE ──
  preamble.push(`\\documentclass[${classOpts.join(',')}]{${dc}}`);

  // ── 2. CORE ──
  preamble.push(
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage{textcomp}',
  );

  // ── 3. FUENTE ──
  preamble.push(`\\usepackage{${fontFamily}}`);

  // ── 4. INTERLINEADO ──
  preamble.push(
    '\\usepackage{setspace}',
    `\\setstretch{${lineSpacing}}`,
  );

  // ── 5. MÁRGENES ──
  if (geometry?.options && geometry.options.length > 0) {
    preamble.push(`\\usepackage[${geometry.options.join(',')}]{geometry}`);
  }

  // ── 6. IDIOMA ──
  if (fmt.babel?.options && fmt.babel.options.length > 0) {
    preamble.push(`\\usepackage[${fmt.babel.options.join(',')}]{babel}`);
  }

  // ── 7. ENCABEZADOS ──
  preamble.push(
    '\\usepackage{scrlayer-scrpage}',
    '\\clearpairofpagestyles',
  );
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

  // ── 8. TIPOGRAFÍA ──
  if (fmt.microtype?.options && fmt.microtype.options.length > 0) {
    preamble.push(`\\usepackage[${fmt.microtype.options.join(',')}]{microtype}`);
  }

  // ── 9. COMPOSICIÓN E INTERNOS ──
  if (fmt.raggedbottom !== false) {
    preamble.push('\\raggedbottom');
  }
  preamble.push(
    `\\pretolerance=${fmt.pretolerance ?? 200}`,
    `\\tolerance=${fmt.tolerance ?? 400}`,
    `\\hyphenpenalty=${fmt.brokenpenalty ?? 1000000}`,
    `\\brokenpenalty=${fmt.brokenpenalty ?? 1000000}`,
    `\\finalhyphendemerits=${fmt.finalhyphendemerits ?? 1000000}`,
    `\\doublehyphendemerits=${fmt.doublehyphendemerits ?? 1000000}`,
    `\\widowpenalty=${fmt.widowpenalty ?? 1000000}`,
    `\\clubpenalty=${fmt.clubpenalty ?? 1000000}`,
    '\\newcounter{none}',
    '\\providecommand{\\tightlist}{%',
    '  \\setlength{\\itemsep}{0pt}\\setlength{\\parskip}{0pt}}',
  );

  // ── 10. ENLACES ──
  if (fmt.hyperref?.options && fmt.hyperref.options.length > 0) {
    preamble.push(`\\usepackage[${fmt.hyperref.options.join(',')}]{hyperref}`);
  } else {
    preamble.push('\\usepackage{hyperref}');
  }

  // ── 11. TABLAS ──
  preamble.push(
    '\\usepackage{longtable}',
    '\\usepackage{booktabs}',
    '\\usepackage{array}',
    '\\usepackage{calc}',
  );

  // ── 12. LISTAS ──
  if (fmt.enumitem !== false) {
    preamble.push('\\usepackage{enumitem}');
    if (fmt.setlist) {
      for (const sl of fmt.setlist) {
        preamble.push(`\\setlist[${sl.command}]{${sl.options.join(',')}}`);
      }
    }
  }

  // ── 13. BIBLIOGRAFÍA ──
  const cwd = meta?.cwd;
  if (cwd) {
    const bibFiles = discoverBibFiles(cwd);
    if (bibFiles.length > 0) {
      preamble.push('\\usepackage[style=apa]{biblatex}');
      for (const bib of bibFiles) {
        preamble.push(`\\addbibresource{${bib}}`);
      }
    }
  }

  // ── 14. EXTRAS: eso-pic ──
  if (fmt.esoPic) {
    const esoPicOpts = typeof fmt.esoPic === 'boolean' ? [] : (fmt.esoPic.options ?? []);
    if (esoPicOpts.length > 0) {
      preamble.push(`\\usepackage[${esoPicOpts.join(',')}]{eso-pic}`);
    } else {
      preamble.push('\\usepackage{eso-pic}');
    }
  }

  // ── 14. EXTRAS: pdfx ──
  if (fmt.pdfx) {
    preamble.push('\\usepackage[x-1a]{pdfx}');
    preamble.push('\\pdfpagesattr{}');
  }

  // ── 14. EXTRAS: crop ──
  if (fmt.crop) {
    let cropW: number | undefined;
    let cropH: number | undefined;
    if (pageSize && pageSize !== 'custom' && PAGE_SIZE_DIMS[pageSize]) {
      const [pw, ph] = PAGE_SIZE_DIMS[pageSize];
      cropW = pw + 15;
      cropH = ph + 15;
    } else if (pageSize === 'custom' && geometry?.options) {
      const gw = geometry.options.find((o) => o.startsWith('paperwidth='));
      const gh = geometry.options.find((o) => o.startsWith('paperheight='));
      if (gw && gh) {
        const gwVal = gw.replace('paperwidth=', '');
        const ghVal = gh.replace('paperheight=', '');
        const wp = parseFloat(gwVal);
        const hp = parseFloat(ghVal);
        const unitW = gwVal.replace(/[\d.]/g, '');
        const unitH = ghVal.replace(/[\d.]/g, '');
        if ((unitW === 'mm' || unitW === 'truemm') && (unitH === 'mm' || unitH === 'truemm') && !isNaN(wp) && !isNaN(hp)) {
          cropW = wp + 15;
          cropH = hp + 15;
        }
      }
    }
    if (cropW && cropH) {
      preamble.push(`\\usepackage[width=${cropW}truemm,height=${cropH}truemm,center,cam]{crop}`);
    }
  }

  // ── 15. CONTADORES ──
  if (fmt.setcounter?.secnumdepth !== undefined) {
    preamble.push(`\\setcounter{secnumdepth}{${fmt.setcounter.secnumdepth}}`);
  }
  if (fmt.setcounter?.tocdepth !== undefined) {
    preamble.push(`\\setcounter{tocdepth}{${fmt.setcounter.tocdepth}}`);
  }

  // ── PREAMBLE TRANSPILERS ──
  // Se ejecutan antes de \begin{document} para que sus definiciones
  // esten vigentes cuando se llame a \maketitle.
  const cwdForTranspilers = meta?.cwd;
  const preambleTranspilers = await loadPreambleTranspilers(disabledPreambleTranspilers, cwdForTranspilers);
  for (const tp of preambleTranspilers) {
    tp.process(preamble, fmt);
  }

  // ── CUERPO DEL DOCUMENTO ──
  preamble.push('\\begin{document}');

  // ── PORTADA ──
  if (meta?.title) preamble.push(`\\title{${meta.title}}`);
  if (meta?.author?.length) preamble.push(`\\author{${meta.author.join(' \\and ')}}`);
  if (fmt.showDate) {
    if (meta?.date) {
      preamble.push(`\\date{${meta.date}}`);
    } else if (meta?.filePath) {
      // Usar fecha de creacion del archivo si no hay date en frontmatter
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
  if (meta?.title) preamble.push('\\maketitle');

  // ── TABLA DE CONTENIDOS ──
  if (fmt.toc) {
    preamble.push('\\tableofcontents');
  }

  return preamble;
}
