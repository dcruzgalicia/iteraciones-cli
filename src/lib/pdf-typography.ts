import { BuildError } from './errors.js';
import { plural } from './plural.js';
import { exec, ProcessSpawnError, type RunResult } from './run.js';

/** El orden manda: detección, corrección y reportes van en esta secuencia. */
export const TYPOGRAPHY_RULES = [
  'single-word-line',
  'repeated-last-letter',
  'repeated-first-letter',
  'consecutive-punctuation',
  'hyphenated-proper-noun',
] as const;

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

interface ConsecutivePunctuation extends Incidence {
  type: 'consecutive-punctuation';
  lineas: LineaCoincidencia[];
  total: number;
  continuacion?: string;
}

interface RepeatedLetter extends Incidence {
  type: 'repeated-first-letter' | 'repeated-last-letter';
  letter: string;
  lineas: LineaCoincidencia[];
  total: number;
  continuacion?: string;
}

/** Un nombre propio partido por el guion de corte al final de la línea. */
export interface HyphenatedProperNoun extends Incidence {
  type: 'hyphenated-proper-noun';

  /** El trozo de la palabra, sin el guion del corte. */
  word: string;

  /** El trozo con el que sigue en la línea de abajo, sin guion. */
  continuation?: string;
}

/** El nombre tal como se lee: los dos trozos con el guion del corte. */
export function nombreCortado(incidencia: HyphenatedProperNoun): string {
  return `${incidencia.word}-${incidencia.continuation ?? ''}`;
}

/** La palabra completa, sin el guion del corte. */
export function palabraSinCorte(incidencia: HyphenatedProperNoun): string {
  return `${incidencia.word}${incidencia.continuation ?? ''}`;
}

export type TypographyIncidence = SingleWordLine | ConsecutivePunctuation | RepeatedLetter | HyphenatedProperNoun;

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

function singleWordLines(pages: string[][]): SingleWordLine[] {
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

const ABRE_SIGNO = /^[¿¡«"'([\u2018\u201C]*/;
const NOMBRE_CORTADO = /^[A-ZÁÉÍÓÚÜÑ][\p{L}\p{M}'’]*[-]$/u;

function hyphenatedProperNouns(pages: string[][]): HyphenatedProperNoun[] {
  const hits: HyphenatedProperNoun[] = [];
  for (const [indicePagina, lineas] of pages.entries()) {
    for (const [indice, linea] of lineas.entries()) {
      const palabras = linea.trim().split(/\s+/).filter(Boolean);
      const ultima = palabras.at(-1);
      if (ultima === undefined) continue;
      const sinSignos = ultima.replace(ABRE_SIGNO, '');
      if (!NOMBRE_CORTADO.test(sinSignos)) continue;
      const siguiente = (lineas[indice + 1] ?? '').trim().split(/\s+/).filter(Boolean)[0];
      const continuation = siguiente?.replace(/-$/, '');
      hits.push({
        type: 'hyphenated-proper-noun',
        page: indicePagina + 1,
        line: indice + 1,
        text: linea,
        word: sinSignos.replace(/-$/, ''),
        continuation: continuation === '' ? undefined : continuation,
      });
    }
  }
  return hits;
}

interface LineaCoincidencia {
  line: number;
  text: string;
}

interface Coincidencia {
  page: number;
  lineas: LineaCoincidencia[];
  total: number;
  continuacion?: string;
}

function tiradasCoincidentes(pages: string[][], lineas: number, clave: (linea: string) => string | undefined): Coincidencia[] {
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
          total: lineas,
          continuacion: lineasPagina[desde + lineas],
        });
      }
      inicio = fin;
    }
  }
  return encontradas;
}

function sinAcentos(texto: string): string {
  return (
    texto
      // Sólo se quitan los acentos de las vocales: la ñ es una letra propia y
      // una línea que empieza con «ño» no repite la «n» de «no».
      .replace(/[áàäâã]/gi, 'a')
      .replace(/[éèëê]/gi, 'e')
      .replace(/[íìïî]/gi, 'i')
      .replace(/[óòöôõ]/gi, 'o')
      .replace(/[úùüû]/gi, 'u')
      .replace(/ç/gi, 'c')
      .toLowerCase()
  );
}

/**
 * La primera letra, sin contar los signos de apertura: «¿Y…» y «Y…» empiezan
 * igual, y «a-» cuenta como «a».
 */
function letraInicial(linea: string): string | undefined {
  // Los signos de apertura se saltan, pero un número no: «8 años» y «(8 años»
  // empiezan por un número, no por la letra que viene después.
  const inicio = sinAcentos(linea)
    .trimStart()
    .replace(/^[^a-zñ0-9]+/, '');
  return /^[a-zñ]/.test(inicio) ? inicio.slice(0, 1) : undefined;
}

/** La última letra, sin contar los signos del final. */
function letraFinal(linea: string): string | undefined {
  const texto = sinAcentos(linea).trimEnd();
  // Un número al final no se salta: la línea termina en un número, no en la
  // letra que viene antes («Ficción (2023).» no termina en «n»).
  if (/\d[^\p{L}\p{N}]*$/u.test(texto)) return undefined;
  const letras = texto.replace(/[^a-zñ]+$/, '');
  return letras === '' ? undefined : letras.slice(-1);
}

/** El signo con el que termina la línea, si termina en signo. */
function marcaFinal(linea: string): string | undefined {
  const marca = linea.trimEnd().at(-1);
  return marca !== undefined && TERMINALS.has(marca) ? marca : undefined;
}

function repeatedLetterRuns(pages: string[][], posicion: 'first' | 'last', lineas: number): RepeatedLetter[] {
  const de = (linea: string): string | undefined => (posicion === 'first' ? letraInicial(linea) : letraFinal(linea));
  const tipo = posicion === 'first' ? 'repeated-first-letter' : 'repeated-last-letter';
  const hallados: RepeatedLetter[] = [];
  for (const tirada of tiradasCoincidentes(pages, lineas, de)) {
    const primera = tirada.lineas[0] as LineaCoincidencia;
    hallados.push({
      type: tipo,
      page: tirada.page,
      line: primera.line,
      text: primera.text,
      letter: de(primera.text) ?? '',
      lineas: tirada.lineas,
      total: tirada.total,
      continuacion: tirada.continuacion,
    });
  }
  return hallados;
}

function consecutivePunctuationRuns(pages: string[][], lineas: number): ConsecutivePunctuation[] {
  // Sólo cuenta el mismo signo: «…o.» y «…a-» no son una repetición.
  const clave = (linea: string): string | undefined => marcaFinal(linea);
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

interface ExcepcionTipografia {
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

/** El bloque de texto de una incidencia, con el formato que lee el parser. */
export function formateaExcepcion(incidencia: TypographyIncidence): string {
  if (incidencia.type === 'single-word-line') {
    return `  pág ${incidencia.page}  línea ${incidencia.line}  ${incidencia.type}  ${incidencia.text.trim()}`;
  }
  if (incidencia.type === 'hyphenated-proper-noun') {
    return `  pág ${incidencia.page}  línea ${incidencia.line}  ${incidencia.type}  ${nombreCortado(incidencia)}`;
  }
  const lineas = incidencia.lineas;
  const desde = lineas[0]?.line ?? incidencia.line;
  const hasta = lineas.at(-1)?.line ?? desde;
  const partes = [`  pág ${incidencia.page}  líneas ${desde}-${hasta}  ${incidencia.type}`];
  for (const linea of lineas) partes.push(`         ${linea.line}  ${linea.text.trimEnd()}`);
  if (incidencia.type === 'repeated-first-letter' || incidencia.type === 'repeated-last-letter') {
    const donde = incidencia.type === 'repeated-first-letter' ? 'empiezan' : 'terminan';
    const letra = JSON.stringify(incidencia.letter).replace(/"/g, "'");
    partes.push(`         las ${lineas.length} ${donde} por ${letra}`);
  }
  return partes.join('\n');
}

/**
 * Agrega las incidencias al final del grupo del archivo en el texto de
 * excepciones. Si el grupo no existe, lo crea al final del archivo.
 */
export function agregaExcepcionesAlTexto(texto: string, archivo: string, incidencias: readonly TypographyIncidence[]): string {
  if (incidencias.length === 0) return texto;
  const bloques = incidencias.map(formateaExcepcion);
  const lineas = texto.trim() === '' ? [] : texto.trimEnd().split('\n');
  const cabecera = lineas.findIndex((linea) => /^\S/.test(linea) && normalizaCabeceraArchivo(linea.trim()) === archivo);
  if (cabecera < 0) {
    const separacion = lineas.length > 0 ? [''] : [];
    return [...lineas, ...separacion, archivo, ...bloques].join('\n') + '\n';
  }
  let fin = cabecera + 1;
  while (fin < lineas.length && !/^\S/.test(lineas[fin] as string)) fin++;
  let ultimo = fin - 1;
  while (ultimo > cabecera && (lineas[ultimo] as string).trim() === '') ultimo--;
  const antes = lineas.slice(0, ultimo + 1);
  const despues = lineas.slice(fin);
  const separacion = despues.length > 0 ? [''] : [];
  return [...antes, ...bloques, ...separacion, ...despues].join('\n') + '\n';
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

function filtraExcepciones<T extends TypographyIncidence>(
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
    if (incidencia.type === 'single-word-line' || incidencia.type === 'hyphenated-proper-noun') {
      const texto = incidencia.type === 'single-word-line' ? incidencia.text.trim() : nombreCortado(incidencia);
      return excepcion.lines.length === 1 && excepcion.lines[0]?.line === incidencia.line && excepcion.lines[0]?.text === texto;
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

  /** Páginas pedidas, en tramos. Manda sobre el rango. */
  paginas?: readonly { desde: number; hasta: number }[];
  reglas?: readonly string[];
  lineasMinimas?: number;
  excepciones?: readonly ExcepcionTipografia[];
  archivo?: string;
}

/** Avisa si alguna página pedida no existe en el PDF. */
function validaPaginasPedidas(pdfPath: string, opciones: OpcionesAnalisis, total: number): void {
  const desde = opciones.primeraPagina;
  if (desde !== undefined && desde > total) {
    const pedido =
      opciones.ultimaPagina === undefined || opciones.ultimaPagina === desde ? `la página ${desde}` : `el rango ${desde}-${opciones.ultimaPagina}`;
    throw new BuildError(`${pedido} se sale del PDF "${pdfPath}": el documento tiene ${plural(total, 'página')}`);
  }
  for (const tramo of opciones.paginas ?? []) {
    if (tramo.hasta <= total) continue;
    const pedido = tramo.hasta === tramo.desde ? `la página ${tramo.desde}` : `el rango ${tramo.desde}-${tramo.hasta}`;
    throw new BuildError(`${pedido} se sale del PDF "${pdfPath}": el documento tiene ${plural(total, 'página')}`);
  }
}

const ORDEN_REGLA = new Map(TYPOGRAPHY_RULES.map((regla, indice) => [regla, indice]));

/** El informe va por página, después por línea y, a igual línea, por regla. */
function porPaginaLineaYRegla(a: TypographyIncidence, b: TypographyIncidence): number {
  return a.page - b.page || a.line - b.line || (ORDEN_REGLA.get(a.type) ?? 99) - (ORDEN_REGLA.get(b.type) ?? 99);
}

/** Qué páginas entran: la lista pedida o el rango de siempre. */
function filtroDePaginas(opciones: OpcionesAnalisis, total: number): (pagina: number) => boolean {
  if (opciones.paginas !== undefined) {
    const pedidas = new Set(paginasDeTramos(opciones.paginas));
    return (pagina: number): boolean => pedidas.has(pagina);
  }
  const desde = opciones.primeraPagina ?? 1;
  const hasta = opciones.ultimaPagina ?? total;
  return (pagina: number): boolean => pagina >= desde && pagina <= hasta;
}

function paginasDeTramos(tramos: readonly { desde: number; hasta: number }[]): number[] {
  const paginas: number[] = [];
  for (const tramo of tramos) {
    for (let pagina = tramo.desde; pagina <= tramo.hasta; pagina++) paginas.push(pagina);
  }
  return paginas;
}

export function analyzeText(stdout: string, opciones: OpcionesAnalisis = {}): TypographyIncidence[] {
  const { lineasMinimas = 2, excepciones = [] } = opciones;
  const pedidas = new Set(opciones.reglas ?? TYPOGRAPHY_RULES);
  const pages = splitPages(stdout);
  // Todas las líneas se comparan, sin importar su longitud: lo que no encaje se
  // descarta con `.typography-exceptions`.
  const halladas: TypographyIncidence[] = [
    ...(pedidas.has('single-word-line') ? singleWordLines(pages) : []),
    ...(pedidas.has('repeated-last-letter') ? repeatedLetterRuns(pages, 'last', lineasMinimas) : []),
    ...(pedidas.has('repeated-first-letter') ? repeatedLetterRuns(pages, 'first', lineasMinimas) : []),
    ...(pedidas.has('consecutive-punctuation') ? consecutivePunctuationRuns(pages, lineasMinimas) : []),
    ...(pedidas.has('hyphenated-proper-noun') ? hyphenatedProperNouns(pages) : []),
  ];
  const vivas = excepciones.length === 0 ? halladas : filtraExcepciones(halladas, opciones.archivo ?? '', excepciones);
  const dentro = filtroDePaginas(opciones, pages.length);
  return vivas.filter((incidencia) => dentro(incidencia.page)).sort(porPaginaLineaYRegla);
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
  validaPaginasPedidas(pdfPath, opciones, splitPages(result.stdout).length);
  return analyzeText(result.stdout, opciones);
}
