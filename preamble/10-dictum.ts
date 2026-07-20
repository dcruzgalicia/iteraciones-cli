import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Personaliza \\dictum: ancho, regla, fuente y formato del autor';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Epigrafe (dictum) ---',
    '\\setkomafont{dictum}{\\normalsize\\normalfont\\itshape}',
    '\\renewcommand*{\\dictumwidth}{0.5\\textwidth}',
    '\\renewcommand*{\\dictumrule}{}',
    '\\setkomafont{dictumauthor}{\\normalsize\\normalfont}',
    '\\renewcommand*{\\dictumauthorformat}[1]{#1\\vspace*{32pt}}',
  );
  return preamble;
}
