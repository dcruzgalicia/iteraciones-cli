import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Personaliza el indice (TOC): nombre, espaciado, fuentes y lideres';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Estilo del indice (TOC) ---',
    '\\renewcaptionname{spanish}{\\contentsname}{\\large\\normalfont Índice}',
    '\\BeforeTOCHead{\\RedeclareSectionCommand[beforeskip=30pt,afterskip=2\\baselineskip,afterindent=false]{chapter}}',
    '\\setkomafont{partentry}{\\normalsize\\normalfont}',
    '\\DeclareTOCStyleEntry[linefill=\\TOCLineLeaderFill,beforeskip=2\\baselineskip]{tocline}{part}',
    '\\setkomafont{chapterentry}{\\normalsize\\normalfont\\scshape}',
    '\\DeclareTOCStyleEntry[pagenumberbox=\\phantom,beforeskip=\\baselineskip]{tocline}{chapter}',
    '\\DeclareTOCStyleEntry[entryformat=\\normalsize\\normalfont]{tocline}{section}',
  );
  return preamble;
}
