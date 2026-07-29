import type { PdfFormatConfig } from '../../config/site-config.js';

export const description = 'Redefine \\\\tableofcontents: \\\\section*, compensa espacio posterior de \\\\maketitle';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- TOC como section ---',
    '\\makeatletter',
    '\\renewcommand*{\\tableofcontents}{%',
    '  \\vspace*{-2\\baselineskip}% compensar espacio posterior de \\maketitle',
    '  \\begingroup',
    '    \\section*{\\contentsname}%',
    '    \\@starttoc{toc}%',
    '    \\thispagestyle{empty}% asegurar que pagina del TOC no tenga numero',
    '    \\@afterindentfalse\\@afterheading%',
    '  \\endgroup',
    '}',
    '\\makeatother',
  );
  return preamble;
}
