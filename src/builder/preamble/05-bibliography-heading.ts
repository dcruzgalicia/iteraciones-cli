import type { PdfFormatConfig } from '../../config/site-config.js';

export const description = 'Cambia titulo de bibliografia de chapter a section';

/**
 * Redefine el heading de bibliografia solo si biblatex esta cargado
 * (biblatex se carga unicamente cuando el proyecto tiene archivos .bib).
 * Sin esta condicion, un proyecto sin .bib y pdf.generate: true falla con
 * "Undefined control sequence: \\defbibheading".
 */
export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Bibliografia como section (redefine bibintoc) ---',
    '\\ifcsname ver@biblatex.sty\\endcsname',
    '  \\defbibheading{bibintoc}[\\refname]{%',
    '    \\section{#1}%',
    '  }',
    '\\fi',
  );
  return preamble;
}
