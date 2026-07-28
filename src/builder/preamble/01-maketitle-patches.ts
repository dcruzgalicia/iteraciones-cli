import type { PdfFormatConfig } from '../../config/site-config.js';

export const description = 'Personaliza \\maketitle: 1+2 baselineskip, autor antes de titulo, titulo en mayusculas';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Personalizacion de \\maketitle ---',
    '\\makeatletter',
    '\\renewcommand{\\maketitle}{%',
    '  \\vspace*{1\\baselineskip}%',
    '  \\ifx\\@author\\@empty\\else',
    '    {\\centering\\usekomafont{author}{\\renewcommand{\\and}{\\unskip, \\ignorespaces}\\@author\\par}}%',
    '  \\fi',
    '  \\vskip 1\\baselineskip',
    '  {\\centering\\usekomafont{title}{\\MakeUppercase{\\@title}\\par}}%',
    '  \\ifx\\@subtitle\\@empty\\else',
    '    \\vskip 1\\baselineskip',
    '    {\\centering\\usekomafont{subtitle}{\\@subtitle\\par}}%',
    '  \\fi',
    '  \\ifx\\@date\\@empty\\else',
    '    \\vskip 1\\baselineskip',
    '    {\\centering\\usekomafont{date}{\\@date\\par}}%',
    '  \\fi',
    '  \\vspace*{2\\baselineskip}%',
    '}',
    '\\makeatother',
  );
  return preamble;
}
