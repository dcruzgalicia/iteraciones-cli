import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Define fuentes de \\maketitle via \\setkomafont (title, subtitle, author, publishers)';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Fuentes KOMA para \\maketitle ---',
    '\\setkomafont{title}{\\normalsize\\bfseries}',
    '\\setkomafont{subtitle}{\\normalsize\\normalfont\\itshape}',
    '\\setkomafont{author}{\\normalsize\\normalfont}',
    '\\setkomafont{publishers}{\\normalsize\\normalfont}',
  );
  return preamble;
}
