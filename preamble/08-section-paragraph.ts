import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Personaliza \\paragraph con \\RedeclareSectionCommand y \\setkomafont';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Seccionamiento: paragraph ---',
    '\\RedeclareSectionCommand[beforeskip=\\baselineskip,afterskip=0pt,afterindent=false]{paragraph}',
    '\\setkomafont{paragraph}{\\normalsize\\normalfont}',
  );
  return preamble;
}
