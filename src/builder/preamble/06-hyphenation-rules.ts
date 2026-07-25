import type { PdfFormatConfig } from '../src/config/site-config.js';

export const description = 'Agrega \\hyphenation{} con nombres propios que no deben dividirse';

export function process(preamble: string[], config: PdfFormatConfig): string[] {
  preamble.push(
    '% --- Separacion silabica: nombres que nunca deben dividirse ---',
    '\\hyphenation{',
    '  Cronos',
    '  Kronecker',
    '  Einstein',
    '  Gödel',
    '  Pascal',
    '  Pitágoras',
    '  Wittgenstein',
    '  Heidegger',
    '  Husserl',
    '  Hering',
    '  Eddington',
    '  Poincaré',
    '  Riemann',
    '  Gauss',
    '  Noether',
    '  Hilbert',
    '  Turing',
    '  Von Neumann',
    '  Boole',
    '  Frege',
    '  Cantor',
    '  Weber',
    '  Durkheim',
    '  Bourdieu',
    '  Foucault',
    '  Derrida',
    '  Carnap',
    '  Quine',
    '  Popper',
    '  Kuhn',
    '  Lakatos',
    '  Feyerabend',
    '}',
  );
  return preamble;
}
