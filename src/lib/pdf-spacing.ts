import type { LineaCoincidencia, OpcionesAnalisis, TypographyIncidence } from './pdf-typography.js';

export interface WordBox {
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface LineBox {
  page: number;
  line: number;
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  words: WordBox[];
}

export interface PageBox {
  page: number;
  width: number;
  height: number;
  lines: LineBox[];
}

const GEOMETRY_RULES = ['stretched-line', 'shrunk-line', 'river'] as const;

const BODY_HEIGHT_TOLERANCE = 0.7;
const RIGHT_EDGE_TOLERANCE = 2.5;
const MIN_WORDS = 4;
const STRETCHED_RATIO = 1.8;
const SHRUNK_RATIO = 0.7;
const RIVER_LINES = 3;
const RIVER_OVERLAP = 1.2;
const RIVER_DY_MIN = 8;
const RIVER_DY_MAX = 19;

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (todo, codigo: string) => {
    if (codigo.startsWith('#')) {
      const hex = codigo[1]?.toLowerCase() === 'x';
      const valor = Number.parseInt(codigo.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(valor) ? String.fromCodePoint(valor) : todo;
    }
    const entidades: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return entidades[codigo.toLowerCase()] ?? todo;
  });
}

function atributos(texto: string): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const m of texto.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    if (m[1] !== undefined && m[2] !== undefined) salida[m[1]] = decodeXml(m[2]);
  }
  return salida;
}

function numero(valor: string | undefined): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parser de XML plano, sin dependencias
export function parseBboxLayout(xml: string): PageBox[] {
  const pages: PageBox[] = [];
  for (const pageMatch of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)) {
    const pageAttrs = atributos(pageMatch[1] ?? '');
    const lines: LineBox[] = [];
    for (const lineMatch of (pageMatch[2] ?? '').matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/g)) {
      const lineAttrs = atributos(lineMatch[1] ?? '');
      const words: WordBox[] = [];
      for (const wordMatch of (lineMatch[2] ?? '').matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)) {
        const wordAttrs = atributos(wordMatch[1] ?? '');
        const text = decodeXml(wordMatch[2] ?? '').trim();
        if (text === '') continue;
        words.push({
          text,
          xMin: numero(wordAttrs.xMin),
          xMax: numero(wordAttrs.xMax),
          yMin: numero(wordAttrs.yMin),
          yMax: numero(wordAttrs.yMax),
        });
      }
      if (words.length === 0) continue;
      const index = lines.length + 1;
      lines.push({
        page: pages.length + 1,
        line: index,
        text: words.map((word) => word.text).join(' '),
        xMin: numero(lineAttrs.xMin),
        xMax: numero(lineAttrs.xMax),
        yMin: numero(lineAttrs.yMin),
        yMax: numero(lineAttrs.yMax),
        words,
      });
    }
    pages.push({
      page: pages.length + 1,
      width: numero(pageAttrs.width),
      height: numero(pageAttrs.height),
      lines,
    });
  }
  return pages;
}

function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? (ordenados[medio] as number) : ((ordenados[medio - 1] as number) + (ordenados[medio] as number)) / 2;
}

function moda(valores: number[]): number | undefined {
  if (valores.length === 0) return undefined;
  const cuentas = new Map<number, number>();
  for (const valor of valores) {
    const clave = Number(valor.toFixed(2));
    cuentas.set(clave, (cuentas.get(clave) ?? 0) + 1);
  }
  let mejor: number | undefined;
  let maximo = 0;
  for (const [valor, cuenta] of cuentas) {
    if (cuenta > maximo) {
      mejor = valor;
      maximo = cuenta;
    }
  }
  return mejor;
}

function esIndice(line: LineBox): boolean {
  const puntos = line.words.filter((word) => /^[.…]+$/.test(word.text)).length;
  return puntos / line.words.length > 0.5;
}

function huecos(line: LineBox): Array<{ xMin: number; xMax: number }> {
  const salida: Array<{ xMin: number; xMax: number }> = [];
  for (let i = 0; i < line.words.length - 1; i++) {
    const actual = line.words[i] as WordBox;
    const siguiente = line.words[i + 1] as WordBox;
    const xMin = actual.xMax;
    const xMax = siguiente.xMin;
    if (xMax > xMin) salida.push({ xMin, xMax });
  }
  return salida;
}

function huecoMediano(line: LineBox): number | undefined {
  const anchos = huecos(line).map((hueco) => hueco.xMax - hueco.xMin);
  return anchos.length === 0 ? undefined : mediana(anchos);
}

interface Nodo {
  li: number;
  gi: number;
}

interface Camino {
  largo: number;
  camino: Nodo[];
  xMin: number;
  xMax: number;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: DFS de canales; separar más oscurece el algoritmo
function riverDePagina(page: PageBox, lineas: LineBox[]): TypographyIncidence[] {
  const ordenadas = [...lineas].sort((a, b) => a.yMin - b.yMin);
  const huecosPorLinea = ordenadas.map(huecos);
  const nodos: Nodo[] = [];
  for (let li = 0; li < ordenadas.length; li++) {
    for (let gi = 0; gi < (huecosPorLinea[li]?.length ?? 0); gi++) nodos.push({ li, gi });
  }
  const aristas = new Map<string, Nodo[]>();
  const clave = (nodo: Nodo): string => `${nodo.li}:${nodo.gi}`;
  for (let li = 0; li < ordenadas.length - 1; li++) {
    const dy = (ordenadas[li + 1] as LineBox).yMin - (ordenadas[li] as LineBox).yMin;
    if (dy < RIVER_DY_MIN || dy > RIVER_DY_MAX) continue;
    for (let gi = 0; gi < (huecosPorLinea[li]?.length ?? 0); gi++) {
      const a = huecosPorLinea[li]?.[gi] as { xMin: number; xMax: number };
      for (let gj = 0; gj < (huecosPorLinea[li + 1]?.length ?? 0); gj++) {
        const b = huecosPorLinea[li + 1]?.[gj] as { xMin: number; xMax: number };
        const solape = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin);
        if (solape < RIVER_OVERLAP) continue;
        const desde = clave({ li, gi });
        const lista = aristas.get(desde) ?? [];
        lista.push({ li: li + 1, gi: gj });
        aristas.set(desde, lista);
      }
    }
  }

  const memo = new Map<string, Camino>();
  const mejor = (nodo: Nodo): Camino => {
    const key = clave(nodo);
    const cache = memo.get(key);
    if (cache !== undefined) return cache;
    const hueco = huecosPorLinea[nodo.li]?.[nodo.gi] as { xMin: number; xMax: number };
    let resultado: Camino = { largo: 1, camino: [nodo], xMin: hueco.xMin, xMax: hueco.xMax };
    for (const siguiente of aristas.get(key) ?? []) {
      const sub = mejor(siguiente);
      const xMin = Math.max(hueco.xMin, sub.xMin);
      const xMax = Math.min(hueco.xMax, sub.xMax);
      if (xMax - xMin < RIVER_OVERLAP) continue;
      const largo = 1 + sub.largo;
      const canal = xMax - xMin;
      const canalActual = resultado.xMax - resultado.xMin;
      if (largo > resultado.largo || (largo === resultado.largo && canal > canalActual)) {
        resultado = { largo, camino: [nodo, ...sub.camino], xMin, xMax };
      }
    }
    memo.set(key, resultado);
    return resultado;
  };

  const mejores = new Map<string, Camino>();
  for (const nodo of nodos) {
    const camino = mejor(nodo);
    if (camino.largo < RIVER_LINES) continue;
    const primera = ordenadas[camino.camino[0]?.li ?? 0] as LineBox;
    const ultima = ordenadas[camino.camino.at(-1)?.li ?? 0] as LineBox;
    const xPt = (camino.xMin + camino.xMax) / 2;
    const key = `${page.page}:${primera.line}:${ultima.line}:${Math.round(xPt)}`;
    const previo = mejores.get(key);
    if (previo === undefined || camino.largo > previo.largo || camino.xMax - camino.xMin > previo.xMax - previo.xMin) {
      mejores.set(key, camino);
    }
  }

  const salida: TypographyIncidence[] = [];
  for (const camino of mejores.values()) {
    const lineasCamino = camino.camino.map((nodo) => {
      const line = ordenadas[nodo.li] as LineBox;
      return { line: line.line, text: line.text };
    });
    const primera = lineasCamino[0] as LineaCoincidencia;
    const ultima = lineasCamino.at(-1) as LineaCoincidencia;
    salida.push({
      type: 'river',
      page: page.page,
      line: primera.line,
      text: primera.text,
      from: primera.line,
      to: ultima.line,
      xPt: (camino.xMin + camino.xMax) / 2,
      channelPt: camino.xMax - camino.xMin,
      lineas: lineasCamino,
      total: camino.largo,
      lastText: ultima.text,
    });
  }
  return salida;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orquesta las tres reglas; los helpers ya están separados
export function analyzeBoxes(pages: PageBox[], opciones: OpcionesAnalisis = {}): TypographyIncidence[] {
  const pedidas = new Set<string>(opciones.reglas ?? GEOMETRY_RULES);
  const alturas = pages.flatMap((page) => page.lines.flatMap((line) => line.words.map((word) => word.yMax - word.yMin)));
  const alturaCuerpo = moda(alturas);
  if (alturaCuerpo === undefined) return [];

  const salida: TypographyIncidence[] = [];
  for (const page of pages) {
    const cuerpo = page.lines.filter(
      (line) => Math.abs(line.yMax - line.yMin - alturaCuerpo) < BODY_HEIGHT_TOLERANCE && line.words.length >= MIN_WORDS && !esIndice(line),
    );
    if (cuerpo.length === 0) continue;
    const bordeDerecho = Math.max(...cuerpo.map((line) => line.xMax));
    const justificadas = cuerpo.filter((line) => bordeDerecho - line.xMax <= RIGHT_EDGE_TOLERANCE);
    if (justificadas.length === 0) continue;

    const medianas = justificadas.map(huecoMediano).filter((valor): valor is number => valor !== undefined);
    if (medianas.length === 0) continue;
    const natural = mediana(medianas);
    if (!(natural > 0)) continue;

    for (const line of justificadas) {
      const gapPt = huecoMediano(line);
      if (gapPt === undefined) continue;
      const ratio = gapPt / natural;
      if (pedidas.has('stretched-line') && ratio >= STRETCHED_RATIO) {
        salida.push({ type: 'stretched-line', page: page.page, line: line.line, text: line.text, gapPt, ratio });
      }
      if (pedidas.has('shrunk-line') && ratio <= SHRUNK_RATIO) {
        salida.push({ type: 'shrunk-line', page: page.page, line: line.line, text: line.text, gapPt, ratio });
      }
    }

    if (pedidas.has('river')) salida.push(...riverDePagina(page, justificadas));
  }
  return salida;
}

export function analyzeBbox(xml: string, opciones: OpcionesAnalisis = {}): TypographyIncidence[] {
  return analyzeBoxes(parseBboxLayout(xml), opciones);
}
