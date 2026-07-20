/**
 * Constructor de preámbulo LaTeX compartido entre writeTexFiles y convertToPdf.
 *
 * Dado un PdfFormatConfig y metadatos opcionales (title, author, date),
 * retorna un array de líneas del preámbulo listo para unir con \n.
 * Incluye \begin{document} y \title{}/\author{}/\date{}/\maketitle.
 */
import type { PdfFormatConfig } from '../config/site-config.js';
import { DEFAULT_PDF_FORMAT } from '../config/site-config.js';

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

export async function buildLatexPreamble(pdfFormat?: PdfFormatConfig, meta?: PreambleMeta): Promise<string[]> {
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
    `\\usepackage{${fontFamily}}`,
    '\\usepackage{longtable}',
    '\\usepackage{booktabs}',
    '\\usepackage{array}',
    '\\usepackage{calc}',
    '\\usepackage{setspace}',
    `\\setstretch{${lineSpacing}}`,
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

  // Babel: opciones de idioma (opcional, usa default si no se define)
  if (fmt.babel && fmt.babel.length > 0) {
    preamble.push(`\\usepackage[${fmt.babel.join(',')}]{babel}`);
  }

  // Enumitem: personalizacion de listas (opcional)
  if (fmt.enumitem !== false) {
    preamble.push('\\usepackage{enumitem}');
    if (fmt.setlist) {
      for (const sl of fmt.setlist) {
        preamble.push(`\\setlist[${sl.env}]{${sl.opts.join(',')}}`);
      }
    }
  }

  // Hyperref: opciones del paquete hyperref (opcional)
  if (fmt.hyperref && fmt.hyperref.length > 0) {
    preamble.push(`\\usepackage[${fmt.hyperref.join(',')}]{hyperref}`);
  } else {
    preamble.push('\\usepackage{hyperref}');
  }

  // Microtype: microtipografia (usando config si existe, o default hardcodeado)
  if (fmt.microtype && Object.keys(fmt.microtype).length > 0) {
    const mtOpts: string[] = [];
    for (const [k, v] of Object.entries(fmt.microtype)) {
      if (v === true) {
        if (k === 'final') {
          mtOpts.push('final');
        } else {
          mtOpts.push(`${k}=true`);
        }
      } else if (v === false) {
        if (k === 'final') {
          mtOpts.push('draft');
        } else {
          mtOpts.push(`${k}=false`);
        }
      } else if (typeof v === 'string' || typeof v === 'number') {
        mtOpts.push(`${k}=${v}`);
      }
    }
    if (mtOpts.length > 0) {
      preamble.push(`\\usepackage[${mtOpts.join(',')}]{microtype}`);
    }
  }

  // Cuadricula de fondo con eso-pic (opcional)
  if (fmt.esoPic) {
    preamble.push('\\usepackage[grid]{eso-pic}');
  }

  // PDF/A-1a con el paquete pdfx (opcional)
  if (fmt.pdfx) {
    preamble.push('\\usepackage[x-1a]{pdfx}');
    preamble.push('\\pdfpagesattr{}');
  }

  // Marcas de corte con el paquete crop (opcional)
  // Calcula width/height como page-size + 15mm para dejar espacio a marcas
  if (fmt.crop) {
    let cropW: number | undefined;
    let cropH: number | undefined;
    const ps = fmt.pageSize;
    if (ps && ps !== 'custom' && PAGE_SIZE_DIMS[ps]) {
      const [pw, ph] = PAGE_SIZE_DIMS[ps];
      cropW = pw + 15;
      cropH = ph + 15;
    } else if (ps === 'custom' && fmt.geometry) {
      // Custom: leer paperwidth/paperheight de geometry
      const gw = fmt.geometry.paperwidth;
      const gh = fmt.geometry.paperheight;
      if (gw && gh) {
        const wp = parseFloat(gw);
        const hp = parseFloat(gh);
        const unitW = gw.replace(/[\d.]/g, '');
        const unitH = gh.replace(/[\d.]/g, '');
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

  // biblatex con auto-descubrimiento de archivos .bib
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

  preamble.push('\\begin{document}');

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
  preamble.push('\\cleardoublepage');

  // Tabla de contenidos (opcional)
  // Profundidad de numeracion de secciones (sec-num-depth)
  if (fmt.secNumDepth !== undefined) {
    preamble.push(`\\setcounter{secnumdepth}{${fmt.secNumDepth}}`);
  }

  // Profundidad del indice (toc-depth) y tabla de contenidos
  if (fmt.tocDepth !== undefined) {
    preamble.push(`\\setcounter{tocdepth}{${fmt.tocDepth}}`);
  }
  if (fmt.toc) {
    preamble.push('\\tableofcontents');
    preamble.push('\\cleardoublepage');
  }

  return preamble;
}
