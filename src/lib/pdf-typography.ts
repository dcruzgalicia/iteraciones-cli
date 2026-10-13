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
 * Descarta los folios, pero sólo si el documento se los está numerando. La señal es el desfase:
 * el folio tiene que estar a la misma distancia de la página del PDF en todas las páginas, y gana
 * el desfase que se repita más.
 *
 * Se probó exigir que el número suba de uno en uno y no sirve: en un libro real hay páginas en
 * blanco, y en blanco no hay folio, así que la secuencia salta de 13 a 15 y un solo hueco tumbaba
 * las 88 páginas. El desfase constante aguanta los huecos.
 *
 * También es lo que protege de callar un título como «1984»: en la página 3 el desfase sería 1981
 * y no encaja con el del resto, así que se sigue reportando.
 */
const MIN_FOLIOS_CONFIRMADOS = 2;

function foliosConfirmados(pages: string[][]): Set<string> {
  const porDesfase = new Map<number, string[]>();
  for (const [indicePagina, lineas] of pages.entries()) {
    for (const folio of foliosDe(lineas)) {
      const desfase = folio.valor - (indicePagina + 1);
      const clave = `${indicePagina + 1}:${folio.line}`;
      const lista = porDesfase.get(desfase);
      if (lista === undefined) porDesfase.set(desfase, [clave]);
      else lista.push(clave);
    }
  }
  let mejor: string[] = [];
  for (const lista of porDesfase.values()) {
    if (lista.length > mejor.length) mejor = lista;
  }
  if (mejor.length < MIN_FOLIOS_CONFIRMADOS) return new Set();
  return new Set(mejor);
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

/**
 * La moda del ancho, es decir el valor que más se repite. En texto justificado es la medida:
 * casi todas las líneas de un párrafo llegan al borde, así que el ancho de columna es el más
 * común y las últimas líneas del párrafo son las raras.
 *
 * Sólo cuenta si algún ancho se repite. Si todos son distintos no hay moda de verdad, y
 * quedarse con el mayor sería medir la línea más larga del documento (una tabla, una URL sin
 * cortes) y reventar el umbral.
 */
function modaDe(anchos: number[]): number | undefined {
  const cuenta = new Map<number, number>();
  for (const ancho of anchos) cuenta.set(ancho, (cuenta.get(ancho) ?? 0) + 1);
  let masFrecuente: number | undefined;
  let maxVeces = 1;
  for (const [ancho, veces] of cuenta) {
    if (veces < 2) continue;
    if (veces > maxVeces || (veces === maxVeces && (masFrecuente === undefined || ancho > masFrecuente))) {
      masFrecuente = ancho;
      maxVeces = veces;
    }
  }
  return masFrecuente;
}

/**
 * El ancho de referencia del texto: el mayor entre el promedio, la mediana y la moda. Se coge el
 * mayor porque lo que se quiere es la medida del documento, no una medida central: el promedio y
 * la mediana los bajan las líneas cortas que se quieren descartar, y con sólo la mediana se perdían
 * los pares de líneas largas. Con líneas de 28, 8 y 12 el promedio da 16.3 (umbral 8.17, y una
 * línea de 8 queda fuera: al revés de lo que se busca) y la mediana da 12 (umbral 6, y se conserva).
 *
 * pdftotext con -layout no rellena con espacios, así que el ancho es el de la línea tal cual.
 */
export function anchoDeReferencia(pages: string[][]): number {
  const anchos: number[] = [];
  for (const pagina of pages) {
    for (const linea of pagina) {
      const ancho = linea.trimEnd().length;
      if (ancho > 0) anchos.push(ancho);
    }
  }
  if (anchos.length === 0) return 0;

  let total = 0;
  for (const ancho of anchos) total += ancho;
  const promedio = total / anchos.length;

  const ordenados = [...anchos].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  const mediana = ordenados.length % 2 === 1 ? (ordenados[medio] as number) : ((ordenados[medio - 1] as number) + (ordenados[medio] as number)) / 2;

  const moda = modaDe(anchos);
  return Math.max(promedio, mediana, moda ?? 0);
}

/**
 * Una línea muy corta no se cuenta como par aunque termine en puntuación: el final de un
 * párrafo corto («a sí mismas.») pegado al principio del siguiente es composición normal, no un
 * problema. Se considera corta la que se queda por debajo del porcentaje dado del ancho.
 */
export function consecutivePunctuationPairs(pages: string[][], porcentajeCorta = 75): ConsecutivePunctuation[] {
  const pares: ConsecutivePunctuation[] = [];
  const limite = (anchoDeReferencia(pages) * porcentajeCorta) / 100;
  for (const [indicePagina, lineas] of pages.entries()) {
    for (let indice = 1; indice < lineas.length; indice++) {
      const text = lineas[indice];
      const previousText = lineas[indice - 1];
      if (text === undefined || previousText === undefined) continue;
      // Una línea sin caracteres no blancos nunca termina en puntuación, así que el corte por
      // línea vacía sale solo. Y como el recorrido es por página, el final de una nunca se
      // compara con el principio de la siguiente.
      if (!endsWithPunctuation(previousText) || !endsWithPunctuation(text)) continue;
      if (text.trimEnd().length < limite || previousText.trimEnd().length < limite) continue;
      pares.push({
        type: 'consecutive-punctuation',
        page: indicePagina + 1,
        line: indice + 1,
        text,
        previousLine: indice,
        previousText,
      });
    }
  }
  return pares;
}

/** Orden: primero las líneas de una sola palabra, después los pares de puntuación. */
export function analyzeText(stdout: string, primeraPagina = 1, porcentajeCorta = 75): TypographyIncidence[] {
  const pages = splitPages(stdout);
  const incidences = [...singleWordLines(pages), ...consecutivePunctuationPairs(pages, porcentajeCorta)];
  if (primeraPagina === 1) return incidences;
  // pdftotext con -f devuelve sólo las páginas pedidas y las numera desde 1, así que hay que
  // volver a la numeración real del PDF. Se reporta la página del PDF y no el folio impreso,
  // que puede venir en romanos o empezar en otro punto.
  const desplazamiento = primeraPagina - 1;
  return incidences.map((incidencia) => ({ ...incidencia, page: incidencia.page + desplazamiento }));
}

export async function analyzePdf(pdfPath: string, desde = 1, hasta?: number, porcentajeCorta = 75): Promise<TypographyIncidence[]> {
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
  return analyzeText(result.stdout, desde, porcentajeCorta);
}
