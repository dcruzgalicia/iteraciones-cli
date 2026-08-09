import { DEFAULT_HTML_BLOCKS, type HtmlBlockKey } from '../config/site-config.js';

/** Marcador de apertura de un bloque en el HTML (`<!-- block:KEY -->`). */
export const blockMarker = (key: string): string => `<!-- block:${key} -->`;

/**
 * Resuelve el orden de los bloques del masonry: merge de los defaults con los
 * overrides individuales (`format.html.blocks`). Cada clave es opcional; sin
 * ella usa su default. Los empates de número se desempatan por el orden
 * canónico de claves (header → trayectura → formatos → indice → referencias →
 * footer), de modo que el resultado es determinista.
 */
export function resolveBlockOrder(overrides?: Partial<Record<HtmlBlockKey, number>>): HtmlBlockKey[] {
  const canonical = Object.keys(DEFAULT_HTML_BLOCKS) as HtmlBlockKey[];
  const order: Record<HtmlBlockKey, number> = { ...DEFAULT_HTML_BLOCKS, ...overrides };
  return [...canonical].sort((a, b) => order[a] - order[b] || canonical.indexOf(a) - canonical.indexOf(b));
}

interface ExtractedBlock {
  /** Contenido del bloque (marcador + div completo). */
  content: string;
  /** Posición posterior al cierre del div. */
  end: number;
}

/**
 * Extrae el bloque marcado `<!-- block:KEY -->`: el marcador va seguido de un
 * div cuyo cierre se parsea balanceadamente (las tarjetas contienen divs
 * anidados). Retorna undefined si el marcador no existe o el div no cierra
 * (HTML inesperado: no tocar).
 */
function extractBlock(html: string, key: string): ExtractedBlock | undefined {
  const marker = blockMarker(key);
  const start = html.indexOf(marker);
  if (start < 0) return undefined;
  const divStart = html.indexOf('<div', start + marker.length);
  if (divStart < 0) return undefined;

  let depth = 0;
  let i = divStart;
  while (i < html.length) {
    const open = html.indexOf('<div', i);
    const close = html.indexOf('</div>', i);
    if (close < 0) break;
    if (open >= 0 && open < close) {
      depth++;
      i = open + 4;
    } else {
      depth--;
      i = close + 6;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return undefined;
  return { content: html.slice(start, i), end: i };
}

/**
 * Reensambla el masonry: extrae los bloques del template (header, trayectura,
 * indice, footer) por marcador, los combina con los bloques generados por el
 * post-procesamiento (formatos, referencias) y los ordena según `blocks`
 * dentro del `<main>`. Los bloques ausentes (tarjetas condicionales: TOC sin
 * `toc`, referencias sin citas, formatos sin formatos activos) simplemente no
 * se incluyen y no alteran el orden del resto.
 */
export function assembleHtmlBlocks(
  html: string,
  generated: Partial<Record<HtmlBlockKey, string>>,
  blocks?: Partial<Record<HtmlBlockKey, number>>,
): string {
  const mainStart = html.indexOf('<main');
  const mainTagEnd = html.indexOf('>', mainStart);
  const mainEnd = html.lastIndexOf('</main>');
  if (mainStart < 0 || mainTagEnd < 0 || mainEnd < 0) return html;

  const extracted = new Map<HtmlBlockKey, string>();
  const canonical = Object.keys(DEFAULT_HTML_BLOCKS) as HtmlBlockKey[];
  for (const key of canonical) {
    const fromTemplate = extractBlock(html, key);
    if (fromTemplate) extracted.set(key, fromTemplate.content);
    const generatedBlock = generated[key];
    if (generatedBlock) extracted.set(key, generatedBlock);
  }

  const ordered = resolveBlockOrder(blocks)
    .filter((key) => extracted.has(key))
    .map((key) => extracted.get(key))
    .join('\n');

  return `${html.slice(0, mainTagEnd + 1)}\n${ordered}\n${html.slice(mainEnd)}`;
}
