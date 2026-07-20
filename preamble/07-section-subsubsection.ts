import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Personaliza \\subsubsection con \\RedeclareSectionCommand y \\setkomafont';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Seccionamiento: subsubsection ---',
    '\\RedeclareSectionCommand[beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}',
    '\\setkomafont{subsubsection}{\\normalsize\\normalfont\\itshape}',
  );
  return preamble;
}
