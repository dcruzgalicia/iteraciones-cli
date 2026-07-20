import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Personaliza \\subsection con \\RedeclareSectionCommand y \\setkomafont';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Seccionamiento: subsection ---',
    '\\RedeclareSectionCommand[beforeskip=2\\baselineskip,afterskip=2\\baselineskip,afterindent=false]{subsection}',
    '\\setkomafont{subsection}{\\normalsize\\normalfont\\textit}',
  );
  return preamble;
}
