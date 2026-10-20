import { BuildError } from './errors.js';
import { plural } from './plural.js';
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
  prev?: string;
  next?: string;
}

export interface ConsecutivePunctuation extends Incidence {
  type: 'consecutive-punctuation';
  lineas: LineaCoincidencia[];
  total: number;
  continuacion?: string;
}

export interface RepeatedLetter extends Incidence {
  type: 'repeated-first-letter' | 'repeated-last-letter';
  letter: string;
  lineas: LineaCoincidencia[];
  total: number;
  continuacion?: string;
}

export type TypographyIncidence = SingleWordLine | ConsecutivePunctuation | RepeatedLetter;

const PAGE_BREAK = '\f';

export function splitPages(stdout: string): string[][] {
  const trozos = stdout.split(PAGE_BREAK);
  const paginas = trozos.at(-1) === '' ? trozos.slice(0, -1) : trozos;
  return paginas.map((pagina) => {
    const lineas = pagina.split('\n');
    if (lineas.at(-1) === '') lineas.pop();
    return lineas;
  });
}

function words(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

const SOLO_DIGITOS = /^\d+$/;

interface Folio {
  line: number;
  valor: number;
}

function bordes(lineas: string[]): number[] {
  const conTexto = lineas.flatMap((linea, indice) => (linea.trim() === '' ? [] : [indice]));
  if (conTexto.length === 0) return [];
  return conTexto[0] === conTexto.at(-1) ? [conTexto[0] as number] : [conTexto[0] as number, conTexto.at(-1) as number];
}

function foliosDe(lineas: string[]): Folio[] {
  const hallados: Folio[] = [];
  for (const indice of bordes(lineas)) {
    const texto = (lineas[indice] as string).trim();
    if (!SOLO_DIGITOS.test(texto)) continue;
    hallados.push({ line: indice + 1, valor: Number(texto) });
  }
  return hallados;
}

const MIN_FOLIOS_CONFIRMADOS = 2;

function foliosConfirmados(pages: string[][]): Set<string> {
  const confirmados = new Set<string>();
  const porDesfase = new Map<number, string[]>();
  for (const [indicePagina, lineas] of pages.entries()) {
    const pagina = indicePagina + 1;
    for (const folio of foliosDe(lineas)) {
      const clave = `${pagina}:${folio.line}`;
      if (folio.valor === pagina) confirmados.add(clave);
      const desfase = folio.valor - pagina;
      const lista = porDesfase.get(desfase);
      if (lista === undefined) porDesfase.set(desfase, [clave]);
      else lista.push(clave);
    }
  }
  for (const lista of porDesfase.values()) {
    if (lista.length < MIN_FOLIOS_CONFIRMADOS) continue;
    for (const clave of lista) confirmados.add(clave);
  }
  return confirmados;
}

export function singleWordLines(pages: string[][]): SingleWordLine[] {
  const folios = foliosConfirmados(pages);
  const hits: SingleWordLine[] = [];
  for (const [indicePagina, lineas] of pages.entries()) {
    for (const [indice, text] of lineas.entries()) {
      if (words(text).length !== 1) continue;
      if (folios.has(`${indicePagina + 1}:${indice + 1}`)) continue;
      const prev = indice > 0 ? (lineas[indice - 1] as string).trim() : undefined;
      const next = indice < lineas.length - 1 ? (lineas[indice + 1] as string).trim() : undefined;
      hits.push({ type: 'single-word-line', page: indicePagina + 1, line: indice + 1, text, prev, next });
    }
  }
  return hits;
}

const TERMINALS = new Set(['.', ',', ';', ':', '?', '!', '…', '-', '–', '—', ')', ']', '}', '"', "'", '»', '”', '’']);

function endsWithPunctuation(line: string): boolean {
  const last = line.trimEnd().at(-1);
  return last !== undefined && TERMINALS.has(last);
}

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
  continuacion?: string;
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
      for (let desde = inicio; desde + lineas <= fin; desde++) {
        encontradas.push({
          page: indicePagina + 1,
          lineas: lineasPagina.slice(desde, desde + lineas).map((text, k) => ({ line: desde + k + 1, text })),
          total: fin - desde,
          continuacion: lineasPagina[desde + lineas],
        });
      }
      inicio = fin;
    }
  }
  return encontradas;
}

function colapsaVentanas<T extends TypographyIncidence>(incidencias: readonly T[]): T[] {
  const vistas = new Set<string>();
  const resultado: T[] = [];
  for (const incidencia of incidencias) {
    if (incidencia.type === 'single-word-line') {
      resultado.push(incidencia);
      continue;
    }
    const clave = `${incidencia.type}:${incidencia.page}:${incidencia.line + incidencia.total - 1}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    resultado.push(incidencia);
  }
  return resultado;
}

function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function letraInicial(linea: string, cuantas: number): string | undefined {
  const inicio = sinAcentos(linea).trimStart().slice(0, cuantas);
  return inicio.length === cuantas && /^[a-z]+$/.test(inicio) ? inicio : undefined;
}

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
      continuacion: tirada.continuacion,
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
      continuacion: tirada.continuacion,
    });
  }
  return hallados;
}

export interface ExcepcionTipografia {
  file: string;
  page: number;
  type: string;
  startLine: number;
  endLine: number;
  total: number;
  lines: Array<{ line: number; text: string }>;
}

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
  excepciones?: readonly ExcepcionTipografia[];
  archivo?: string;
}

export function analyzeText(stdout: string, opciones: OpcionesAnalisis = {}): TypographyIncidence[] {
  const { primeraPagina = 1, ultimaPagina, porcentajeCorta = 75, lineasMinimas = 3, letrasMinimas = 2, excepciones = [] } = opciones;
  const pedidas = new Set(opciones.reglas ?? TYPOGRAPHY_RULES);
  const pages = splitPages(stdout);
  const ancho = (anchoDeReferencia(pages) * porcentajeCorta) / 100;
  const halladas: TypographyIncidence[] = [
    ...(pedidas.has('single-word-line') ? singleWordLines(pages) : []),
    ...(pedidas.has('repeated-last-letter') ? repeatedLetterRuns(pages, 'last', lineasMinimas, letrasMinimas, ancho) : []),
    ...(pedidas.has('consecutive-punctuation') ? consecutivePunctuationRuns(pages, lineasMinimas, ancho) : []),
    ...(pedidas.has('repeated-first-letter') ? repeatedLetterRuns(pages, 'first', lineasMinimas, letrasMinimas, ancho) : []),
  ];
  const vivas = excepciones.length === 0 ? halladas : filtraExcepciones(halladas, opciones.archivo ?? '', excepciones);
  const hasta = ultimaPagina ?? pages.length;
  return colapsaVentanas(vivas).filter((incidencia) => incidencia.page >= primeraPagina && incidencia.page <= hasta);
}

export async function analyzePdf(pdfPath: string, opciones: OpcionesAnalisis = {}): Promise<TypographyIncidence[]> {
  let result: RunResult;
  try {
    result = await exec('pdftotext', ['-layout', pdfPath, '-']);
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
  const desde = opciones.primeraPagina;
  if (desde !== undefined) {
    const total = splitPages(result.stdout).length;
    if (desde > total) {
      const pedido =
        opciones.ultimaPagina === undefined || opciones.ultimaPagina === desde ? `la página ${desde}` : `el rango ${desde}-${opciones.ultimaPagina}`;
      throw new BuildError(`${pedido} se sale del PDF "${pdfPath}": el documento tiene ${plural(total, 'página')}`);
    }
  }
  return analyzeText(result.stdout, opciones);
}
