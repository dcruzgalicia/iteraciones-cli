import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Define \\partpagestyle y \\chapterpagestyle como empty';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Estilo de pagina para partes y capitulos ---',
    '\\renewcommand*{\\partpagestyle}{empty}',
    '\\renewcommand*{\\chapterpagestyle}{empty}',
  );
  return preamble;
}
