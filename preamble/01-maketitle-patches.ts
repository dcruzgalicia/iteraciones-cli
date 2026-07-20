import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Personaliza \\maketitle: 3 baselineskip antes, autores separados por coma';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Personalizacion de \\maketitle ---',
    '\\makeatletter',
    '\\renewcommand{\\maketitle}{%',
    '  \\vspace*{3\\baselineskip}%',
    '  {\\centering\\usekomafont{title}{\\@title\\par}}%',
    '  \\ifx\\@subtitle\\@empty\\else',
    '    \\vskip 0\\baselineskip',
    '    {\\centering\\usekomafont{subtitle}{\\@subtitle\\par}}%',
    '  \\fi',
    '  \\ifx\\@author\\@empty\\else',
      '    \\vskip 0\\baselineskip',
      '    {\\centering\\usekomafont{author}{\\normalsize\\renewcommand{\\and}{\\unskip,\\ignorespaces}\\@author\\par}}%',
      '  \\fi',
    '  \\ifx\\@date\\@empty\\else',
    '    \\vskip 0\\baselineskip',
    '    {\\centering\\usekomafont{date}{\\@date\\par}}%',
    '  \\fi',
    '}',
    '\\makeatother',
  );
  return preamble;
}
