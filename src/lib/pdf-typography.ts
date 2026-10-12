import { BuildError } from './errors.js';
import { exec, ProcessSpawnError, type RunResult } from './run.js';

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
  // pdftotext cierra el documento con su propio \f, así que el último trozo es siempre
  // el que queda vacío. Si no lo estuviera, significaría que la salida no viene de
  // pdftotext y mejor no tirar una página entera sin avisar.
  const paginas = trozos.at(-1) === '' ? trozos.slice(0, -1) : trozos;
  return paginas.map((pagina) => {
    const lineas = pagina.split('\n');
    if (lineas.at(-1) === '') lineas.pop();
    return lineas;
  });
}

/** Una palabra es una secuencia de caracteres no blancos; con -layout casi toda línea trae espacio al final. */
function words(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

/** Sólo dígitos: el folio que pone el CLI y el que pone casi cualquier clase es arábigo. */
const SOLO_DIGITOS = /^\d+$/;

interface Folio {
  line: number;
  valor: number;
}

/** Los bordes con texto de una página: la primera y la última línea no vacía. */
function bordes(lineas: string[]): number[] {
  const conTexto = lineas.flatMap((linea, indice) => (linea.trim() === '' ? [] : [indice]));
  if (conTexto.length === 0) return [];
  return conTexto[0] === conTexto.at(-1) ? [conTexto[0] as number] : [conTexto[0] as number, conTexto.at(-1) as number];
}

/**
 * Las líneas de una página que podrían ser un folio: un número solo, al principio o al final.
 * El folio va en el header o en el footer según la configuración, y pdftotext lo devuelve como
 * una línea más, así que sin esto cada página reporta un single-word-line que no es del texto.
 */
function foliosDe(lineas: string[]): Folio[] {
  const hallados: Folio[] = [];
  for (const indice of bordes(lineas)) {
    const texto = (lineas[indice] as string).trim();
    if (!SOLO_DIGITOS.test(texto)) continue;
    hallados.push({ line: indice + 1, valor: Number(texto) });
  }
  return hallados;
}

/**
 * Descarta los folios, pero sólo si el documento se los está numerando: hace falta que salgan en
 * al menos dos páginas y que el número vaya subiendo de uno en uno. Sin esa corroboración, un
 * título como «1984» al principio de una página se quedaría sin reportar, y eso sí es un hallazgo.
 */
function foliosConfirmados(pages: string[][]): Set<string> {
  const candidatos = pages.flatMap((lineas, indice) => {
    const hallados = foliosDe(lineas);
    // Una página con dos números en los bordes tiene folio doble: raro, y no hay forma de
    // saber cuál de los dos es el bueno, así que esa página no cuenta como candidata.
    if (hallados.length !== 1) return [];
    return [{ pagina: indice + 1, folio: hallados[0] as Folio }];
  });
  if (candidatos.length < 2) return new Set();
  for (const [indice, candidato] of candidatos.entries()) {
    if (indice === 0) continue;
    const anterior = (candidatos[indice - 1] as { folio: Folio }).folio.valor;
    if ((candidato.folio.valor as number) !== anterior + 1) return new Set();
  }
  return new Set(candidatos.map((c) => `${c.pagina}:${(c.folio as Folio).line}`));
}

export function singleWordLines(pages: string[][]): SingleWordLine[] {
  const folios = foliosConfirmados(pages);
  const hits: SingleWordLine[] = [];
  for (const [indicePagina, lineas] of pages.entries()) {
    for (const [indice, text] of lineas.entries()) {
      if (words(text).length !== 1) continue;
      if (folios.has(`${indicePagina + 1}:${indice + 1}`)) continue;
      hits.push({ type: 'single-word-line', page: indicePagina + 1, line: indice + 1, text });
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
export function analyzeText(stdout: string, primeraPagina = 1): TypographyIncidence[] {
  const pages = splitPages(stdout);
  const incidences = [...singleWordLines(pages), ...consecutivePunctuationPairs(pages)];
  if (primeraPagina === 1) return incidences;
  // pdftotext con -f devuelve sólo las páginas pedidas y las numera desde 1, así que hay que
  // volver a la numeración real del PDF. Se reporta la página del PDF y no el folio impreso,
  // que puede venir en romanos o empezar en otro punto.
  const desplazamiento = primeraPagina - 1;
  return incidences.map((incidencia) => ({ ...incidencia, page: incidencia.page + desplazamiento }));
}

export async function analyzePdf(pdfPath: string, desde = 1, hasta?: number): Promise<TypographyIncidence[]> {
  const recorte = [...(desde === 1 ? [] : ['-f', String(desde)]), ...(hasta === undefined ? [] : ['-l', String(hasta)])];
  let result: RunResult;
  try {
    result = await exec('pdftotext', [...recorte, '-layout', pdfPath, '-']);
  } catch (err) {
    if (err instanceof ProcessSpawnError) {
      throw new BuildError(`typography necesita pdftotext, que no está en PATH. Instala poppler (por ejemplo: brew install poppler).`);
    }
    throw err;
  }
  if (result.exitCode !== 0) {
    const motivo = result.stderr.trim().split('\n').pop() ?? 'error desconocido';
    throw new BuildError(`pdftotext no pudo leer "${pdfPath}": ${motivo}`);
  }
  return analyzeText(result.stdout, desde);
}
