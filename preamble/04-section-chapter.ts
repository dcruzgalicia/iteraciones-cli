import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Personaliza \\chapter con \\RedeclareSectionCommand y \\setkomafont';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Seccionamiento: chapter ---',
    '\\RedeclareSectionCommand[beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false,style=chapter]{chapter}',
    '\\setkomafont{chapter}{\\normalsize\\normalfont\\scshape}',
    '\\renewcommand{\\raggedchapter}{\\centering}',
  );
  return preamble;
}
