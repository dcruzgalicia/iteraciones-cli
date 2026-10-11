import { BuildError } from './errors.js';
import { exec } from './run.js';

export const TYPOGRAPHY_RULES = ['single-word-line', 'consecutive-punctuation'] as const;

export type TypographyRule = (typeof TYPOGRAPHY_RULES)[number];

interface Incidence {
  page: number;
  line: number;
  text: string;
}

export interface SingleWordLine extends Incidence {
  type: 'single-word-line';
}

export interface ConsecutivePunctuation extends Incidence {
  type: 'consecutive-punctuation';
  previousLine: number;
  previousText: string;
}

export type TypographyIncidence = SingleWordLine | ConsecutivePunctuation;

/** pdftotext separa las páginas con un \f pegado al inicio de la primera línea de la siguiente. */
const PAGE_BREAK = '\f';

/**
 * Trocea la salida de pdftotext en páginas y líneas. El \f va pegado a la línea que abre la
 * página siguiente (no después de un \n), así que se parte por \f y no por \n; el \f final
 * deja un trozo vacío de más y una página en blanco deja un trozo vacío en medio.
 */
export function splitPages(stdout: string): string[][] {
  const trozos = stdout.split(PAGE_BREAK);
  trozos.pop();
  return trozos.map((pagina) => {
    const lineas = pagina.split('\n');
    if (lineas.at(-1) === '') lineas.pop();
    return lineas;
  });
}

/** Una palabra es una secuencia de caracteres no blancos; con -layout casi toda línea trae espacio al final. */
function words(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

export function singleWordLines(pages: string[][]): SingleWordLine[] {
  const hits: SingleWordLine[] = [];
  for (const [indicePagina, lineas] of pages.entries()) {
    for (const [indice, text] of lineas.entries()) {
      if (words(text).length === 1) hits.push({ type: 'single-word-line', page: indicePagina + 1, line: indice + 1, text });
    }
  }
  return hits;
}

const TERMINALS = new Set(['.', ',', ';', ':', '?', '!', '…', '-', '–', '—', ')', ']', '}', '"', "'", '»', '”', '’']);

function endsWithPunctuation(line: string): boolean {
  const last = line.trimEnd().at(-1);
  return last !== undefined && TERMINALS.has(last);
}

export function consecutivePunctuationPairs(pages: string[][]): ConsecutivePunctuation[] {
  const pairs: ConsecutivePunctuation[] = [];
  for (const [indicePagina, lineas] of pages.entries()) {
    for (let indice = 1; indice < lineas.length; indice++) {
      const text = lineas[indice];
      const previousText = lineas[indice - 1];
      if (text === undefined || previousText === undefined) continue;
      // Una línea sin caracteres no blancos nunca termina en puntuación, así que el corte por
      // línea vacía sale solo. Y como el recorrido es por página, el final de una nunca se
      // compara con el principio de la siguiente.
      if (!endsWithPunctuation(previousText) || !endsWithPunctuation(text)) continue;
      pairs.push({
        type: 'consecutive-punctuation',
        page: indicePagina + 1,
        line: indice + 1,
        text,
        previousLine: indice,
        previousText,
      });
    }
  }
  return pairs;
}

/** Orden: primero las líneas de una sola palabra, después los pares de puntuación. */
export function analyzeText(stdout: string): TypographyIncidence[] {
  const pages = splitPages(stdout);
  return [...singleWordLines(pages), ...consecutivePunctuationPairs(pages)];
}

export async function analyzePdf(pdfPath: string): Promise<TypographyIncidence[]> {
  const result = await exec('pdftotext', ['-layout', pdfPath, '-']);
  if (result.exitCode !== 0) {
    const motivo = result.stderr.trim().split('\n').pop() ?? 'error desconocido';
    throw new BuildError(`pdftotext no pudo leer "${pdfPath}": ${motivo}`);
  }
  return analyzeText(result.stdout);
}
