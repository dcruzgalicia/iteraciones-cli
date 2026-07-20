import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Personaliza \\part con \\RedeclareSectionCommand y \\setkomafont';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Seccionamiento: part ---',
    '\\RedeclareSectionCommand[beforeskip=11\\baselineskip,afterskip=\\baselineskip,afterindent=false]{part}',
    '\\setkomafont{part}{\\normalsize\\bfseries\\MakeUppercase}',
  );
  return preamble;
}
