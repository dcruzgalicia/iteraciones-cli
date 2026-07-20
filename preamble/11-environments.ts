import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Redefine center, flushright, flushleft sin espacio vertical extra';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Entornos de alineacion ---',
    '\\renewenvironment{center}{\\par\\centering}{\\par}',
    '\\renewenvironment{flushright}{\\par\\raggedleft}{\\par}',
    '\\renewenvironment{flushleft}{\\par\\raggedright}{\\par}',
  );
  return preamble;
}
