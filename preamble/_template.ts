// Directorio de transpilers de preámbulo LaTeX.
//
// Cada archivo debe exportar:
//   description?: string              — texto descriptivo
//   process(preamble: string[], config: PdfFormatConfig): string[]
//
// El array preamble contiene las líneas del preámbulo ya construidas por
// buildLatexPreamble(). La función puede modificarlo o agregar nuevas líneas.
//
// Los transpilers se ejecutan en orden alfabético (01-, 02-, …).
// Para crear uno, copia este archivo como plantilla:
//
//   export const description = 'Agrega un paquete personalizado';
//   export function process(preamble: string[], config: PdfFormatConfig): string[] {
//     preamble.push('\\usepackage{mi-paquete}');
//     return preamble;
//   }
