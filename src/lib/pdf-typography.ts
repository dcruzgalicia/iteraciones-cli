import { BuildError } from './errors.js';
import { exec, ProcessSpawnError, type RunResult } from './run.js';

export const TYPOGRAPHY_RULES = ['single-word-line', 'consecutive-punctuation', 'repeated-first-letter', 'repeated-last-letter'] as const;

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
  lineas: LineaCoincidencia[];
  total: number;
}

export interface RepeatedLetter extends Incidence {
  type: 'repeated-first-letter' | 'repeated-last-letter';
  letter: string;
  lineas: LineaCoincidencia[];
  total: number;
}

export type TypographyIncidence = SingleWordLine | ConsecutivePunctuation | RepeatedLetter;

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

export interface LineaCoincidencia {
  line: number;
  text: string;
}

export interface Coincidencia {
  page: number;
  lineas: LineaCoincidencia[];
  total: number;
}

export function tiradasCoincidentes(pages: string[][], lineas: number, clave: (linea: string) => string | undefined): Coincidencia[] {
  const encontradas: Coincidencia[] = [];
  for (const [indicePagina, lineasPagina] of pages.entries()) {
    let inicio = 0;
    while (inicio < lineasPagina.length) {
      const actual = clave(lineasPagina[inicio] as string);
      if (actual === undefined) {
        inicio += 1;
        continue;
      }
      let fin = inicio + 1;
      while (fin < lineasPagina.length && clave(lineasPagina[fin] as string) === actual) fin += 1;
      const largo = fin - inicio;
      if (largo >= lineas) {
        encontradas.push({
          page: indicePagina + 1,
          lineas: lineasPagina.slice(inicio, inicio + lineas).map((text, k) => ({ line: inicio + k + 1, text })),
          total: largo,
        });
      }
      inicio = fin;
    }
  }
  return encontradas;
}

/** Sin acentos y en minúscula: «Jardín» y «jardín» empiezan igual para quien lee. */
function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * La letra con la que empieza la línea, o nada si no empieza por una letra. Es estricto: un
 * © o una comilla delante hacen que la línea no empiece por letra, porque así se lee.
 */
function letraInicial(linea: string, cuantas: number): string | undefined {
  const inicio = sinAcentos(linea).trimStart().slice(0, cuantas);
  return inicio.length === cuantas && /^[a-z]+$/.test(inicio) ? inicio : undefined;
}

/**
 * La letra con la que termina la línea, o nada si no termina por una letra. También estricto, y
 * por el mismo motivo: una línea que acaba en coma no termina en letra sino en puntuación, y ya
 * la cubre consecutive-punctuation. Sin esto, «…Rojas, / …Editores,» salía como letra repetida
 * siendo las dos terminan en puntuación.
 */
function letraFinal(linea: string, cuantas: number): string | undefined {
  const t = sinAcentos(linea).trimEnd();
  const fin = t.slice(-cuantas);
  return fin.length === cuantas && /^[a-z]+$/.test(fin) ? fin : undefined;
}

export function repeatedLetterRuns(pages: string[][], posicion: 'first' | 'last', lineas: number, letras: number, anchoMinimo = 0): RepeatedLetter[] {
  const de = (linea: string): string | undefined => (posicion === 'first' ? letraInicial(linea, letras) : letraFinal(linea, letras));
  const conAncho = (linea: string): string | undefined => (linea.trimEnd().length >= anchoMinimo ? de(linea) : undefined);
  const tipo = posicion === 'first' ? 'repeated-first-letter' : 'repeated-last-letter';
  const hallados: RepeatedLetter[] = [];
  for (const tirada of tiradasCoincidentes(pages, lineas, conAncho)) {
    const primera = tirada.lineas[0] as LineaCoincidencia;
    hallados.push({
      type: tipo,
      page: tirada.page,
      line: primera.line,
      text: primera.text,
      letter: conAncho(primera.text) ?? '',
      lineas: tirada.lineas,
      total: tirada.total,
    });
  }
  return hallados;
}

export function consecutivePunctuationRuns(pages: string[][], lineas: number, anchoMinimo: number): ConsecutivePunctuation[] {
  const clave = (linea: string): string | undefined => (linea.trimEnd().length >= anchoMinimo && endsWithPunctuation(linea) ? 'p' : undefined);
  const hallados: ConsecutivePunctuation[] = [];
  for (const tirada of tiradasCoincidentes(pages, lineas, clave)) {
    const primera = tirada.lineas[0] as LineaCoincidencia;
    hallados.push({
      type: 'consecutive-punctuation',
      page: tirada.page,
      line: primera.line,
      text: primera.text,
      lineas: tirada.lineas,
      total: tirada.total,
    });
  }
  return hallados;
}

/** Todas las reglas, para cuando no se pide ninguna en concreto. */
export const TODAS_LAS_REGLAS: readonly TypographyRule[] = TYPOGRAPHY_RULES;

export interface ExcepcionTipografia {
  file: string;
  page: number;
  type: string;
  startLine: number;
  endLine: number;
  total: number;
  lines: Array<{ line: number; text: string }>;
}

/**
 * Lee un archivo de excepciones en texto plano. Un bloque empieza con una línea sin indentar
 * (la ruta del PDF) y sigue con las líneas indentadas del caso tal como lo imprime el informe.
 * Los bloques se separan por una línea en blanco.
 */
function normalizaCabeceraArchivo(titulo: string): string {
  const m = /^(.*?)\s+·\s+\d+\s+incidencias?\s*$/i.exec(titulo.trim());
  return (m?.[1] ?? titulo).trim();
}

export function parseaExcepciones(texto: string): ExcepcionTipografia[] {
  const bloques: Array<{ file: string; lines: string[] }> = [];
  let archivo = '';
  let lineas: string[] = [];

  const vaciar = (): void => {
    if (lineas.length === 0) return;
    bloques.push({ file: archivo, lines: lineas });
    lineas = [];
  };

  for (const linea of texto.split('\n')) {
    if (linea.trim() === '') {
      vaciar();
      continue;
    }
    if (/^\S/.test(linea)) {
      vaciar();
      archivo = normalizaCabeceraArchivo(linea.trim());
      continue;
    }
    if (/^\s*pág\s+\d+\s+(línea|líneas)\b/.test(linea)) {
      vaciar();
    }
    lineas.push(linea);
  }
  vaciar();

  const excepciones: ExcepcionTipografia[] = [];
  for (const bloque of bloques) {
    const excepcion = parseaBloqueExcepcion(bloque.file, bloque.lines);
    if (excepcion) excepciones.push(excepcion);
  }
  return excepciones;
}

function parseaBloqueExcepcion(archivo: string, lines: string[]): ExcepcionTipografia | undefined {
  if (!archivo || lines.length === 0) return undefined;
  const unica = parseaExcepcionUnica(lines[0] ?? '', archivo);
  if (unica) return unica;
  return parseaExcepcionDeBloque(lines, archivo);
}

function parseaExcepcionUnica(linea: string, archivo: string): ExcepcionTipografia | undefined {
  const m = /^\s*pág\s+(\d+)\s+línea\s+(\d+)\s{2,}(\S+)\s{2,}(.*)$/.exec(linea);
  if (!m) return undefined;
  const page = Number(m[1] ?? 0);
  const line = Number(m[2] ?? 0);
  return {
    file: archivo,
    page,
    type: m[3] ?? '',
    startLine: line,
    endLine: line,
    total: 1,
    lines: [{ line, text: (m[4] ?? '').trim() }],
  };
}

function esResumenDeInforme(linea: string): boolean {
  return /^\s*las\s+\d+/.test(linea);
}

function parseaLineasDeExcepcion(lineas: string[]): Array<{ line: number; text: string }> | undefined {
  const resultado: Array<{ line: number; text: string }> = [];
  for (const linea of lineas) {
    const item = /^\s*(\d+) {2}(.*)$/.exec(linea);
    if (!item) {
      if (esResumenDeInforme(linea)) continue;
      return undefined;
    }
    resultado.push({ line: Number(item[1] ?? 0), text: (item[2] ?? '').trimEnd() });
  }
  return resultado;
}

function parseaExcepcionDeBloque(lines: string[], archivo: string): ExcepcionTipografia | undefined {
  const m = /^\s*pág\s+(\d+)\s+líneas\s+(\d+)-(\d+)(?:\s+de\s+(\d+))?\s{2,}(\S+)\s*$/.exec(lines[0] ?? '');
  if (!m) return undefined;
  const incidenceLines = parseaLineasDeExcepcion(lines.slice(1));
  if (incidenceLines === undefined || incidenceLines.length === 0) return undefined;
  const total = m[4] === undefined ? incidenceLines.length : Number(m[4]);
  const startLine = Number(m[2] ?? 0);
  const endLine = Number(m[3] ?? 0);
  return {
    file: archivo,
    page: Number(m[1] ?? 0),
    type: m[5] ?? '',
    startLine,
    endLine,
    total,
    lines: incidenceLines,
  };
}

/** Quita de una lista de incidencias las que coincidan exactamente con una excepción. */
export function filtraExcepciones<T extends TypographyIncidence>(
  incidencias: readonly T[],
  archivo: string,
  excepciones: readonly ExcepcionTipografia[],
): T[] {
  return incidencias.filter((incidencia) => !excepcionCoincide(archivo, incidencia, excepciones));
}

function excepcionCoincide(archivo: string, incidencia: TypographyIncidence, excepciones: readonly ExcepcionTipografia[]): boolean {
  return excepciones.some((excepcion) => {
    if (excepcion.file !== archivo || excepcion.type !== incidencia.type || excepcion.page !== incidencia.page) {
      return false;
    }
    if (incidencia.type === 'single-word-line') {
      return excepcion.lines.length === 1 && excepcion.lines[0]?.line === incidencia.line && excepcion.lines[0]?.text === incidencia.text.trim();
    }
    return (
      excepcion.startLine === incidencia.line &&
      excepcion.total === incidencia.total &&
      excepcion.lines.length === incidencia.lineas.length &&
      excepcion.lines.every(
        (linea, index) => linea.line === incidencia.lineas[index]?.line && linea.text === (incidencia.lineas[index]?.text ?? '').trimEnd(),
      )
    );
  });
}

export interface OpcionesAnalisis {
  primeraPagina?: number;
  ultimaPagina?: number;
  porcentajeCorta?: number;
  reglas?: readonly string[];
  lineasMinimas?: number;
  letrasMinimas?: number;
}

export function analyzeText(stdout: string, opciones: OpcionesAnalisis = {}): TypographyIncidence[] {
  const { primeraPagina = 1, porcentajeCorta = 100, lineasMinimas = 3, letrasMinimas = 2 } = opciones;
  const pedidas = new Set(opciones.reglas ?? TODAS_LAS_REGLAS);
  const pages = splitPages(stdout);
  const ancho = (anchoDeReferencia(pages) * porcentajeCorta) / 100;
  const incidences = [
    ...(pedidas.has('single-word-line') ? singleWordLines(pages) : []),
    ...(pedidas.has('consecutive-punctuation') ? consecutivePunctuationRuns(pages, lineasMinimas, ancho) : []),
    ...(pedidas.has('repeated-first-letter') ? repeatedLetterRuns(pages, 'first', lineasMinimas, letrasMinimas, ancho) : []),
    ...(pedidas.has('repeated-last-letter') ? repeatedLetterRuns(pages, 'last', lineasMinimas, letrasMinimas, ancho) : []),
  ];

  // pdftotext con -f devuelve sólo las páginas pedidas y las numera desde 1, así que hay que
  // volver a la numeración real del PDF. Se reporta la página del PDF y no el folio impreso,
  // que puede venir en romanos o empezar en otro punto.
  const desplazamiento = primeraPagina - 1;
  return incidences.map((incidencia) => ({ ...incidencia, page: incidencia.page + desplazamiento }));
}

export async function analyzePdf(pdfPath: string, opciones: OpcionesAnalisis = {}): Promise<TypographyIncidence[]> {
  const desde = opciones.primeraPagina ?? 1;
  const hasta = opciones.ultimaPagina;
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
  return analyzeText(result.stdout, opciones);
}
