import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Personaliza \\section con \\RedeclareSectionCommand y \\setkomafont';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Seccionamiento: section ---',
    '\\RedeclareSectionCommand[beforeskip=2\\baselineskip,afterskip=2\\baselineskip,afterindent=false]{section}',
    '\\setkomafont{section}{\\normalsize\\bfseries\\MakeUppercase}',
    '\\renewcommand{\\raggedsection}{\\centering}',
  );
  return preamble;
}
