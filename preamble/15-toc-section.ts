import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Redefine \\tableofcontents para usar \\section* en lugar de \\chapter*';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- TOC como section ---',
    '\\makeatletter',
    '\\renewcommand*{\\tableofcontents}{%',
    '  \\begingroup',
    '    \\section*{\\contentsname}%',
    '    \\@starttoc{toc}%',
    '  \\endgroup',
    '}',
    '\\makeatother',
  );
  return preamble;
}
