import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Cambia titulo de bibliografia de chapter a section';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Bibliografia como section (redefine bibintoc) ---',
    '\\defbibheading{bibintoc}[\\refname]{%',
    '  \\section{#1}%',
    '}',
  );
  return preamble;
}
