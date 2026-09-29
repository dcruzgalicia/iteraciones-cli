/**
 * #2483 — el fragmento de un miembro de una collection para su tarjeta en HTML:
 * el primer párrafo o el primer fenced div completo, con a lo más
 * `COLLECTION_FRAGMENT_MAX_WORDS` palabras. Si se pasa, se recorta el texto
 * (dentro del div, conservándolo) y se añade `...` para marcar el corte.
 *
 * Regex sobre texto crudo, como el resto del builder (no hay librería de
 * parseo markdown en el proyecto), para que sea testeable sin pandoc.
 */

/** Límite de palabras del fragmento; constante fija (decisión del #2483). */
export const COLLECTION_FRAGMENT_MAX_WORDS = 100;

/** Marca de corte; pandoc la imprime como `…` (el reader activa `smart`). */
const CUT_MARK = '...';

const BLANK_RE = /^\s*$/;
const ATX_HEADING_RE = /^ {0,3}#{1,6}(?:[ \t].*)?$/;
/** Fenced div de pandoc: colons y, opcionalmente, sus atributos `{...}`. */
const DIV_OPENER_RE = /^ {0,3}(:{3,})(?:[ \t]*\{.*\})?[ \t]*$/;
const DIV_CLOSER_RE = /^ {0,3}(:{3,})[ \t]*$/;
const CODE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** Bloques que no son párrafo: cita, lista, separador, tabla o HTML crudo. */
const NON_PARAGRAPH_RE = /^( {0,3}(?:>[ \t]?|[-+*][ \t]|\d+[.)][ \t]|={3,}[ \t]*$|-{3,}[ \t]*$|[*_]{3,}[ \t]*$|\|)|<[A-Za-z/!])/;
/** Subrayado setext: convierte el párrafo anterior en encabezado, no lo sigue. */
const SETEXT_RE = /^ {0,3}(?:=+|-{2,})[ \t]*$/;

function lineAt(lines: string[], index: number): string {
  return lines[index] ?? '';
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** ¿Están cerrados los enlaces del texto? Un corte que rompe `[...](...)` deja el destino a medias. */
function linksBalanced(text: string): boolean {
  // Contar corchetes basta: el destino `](...)` solo puede quedar abierto al final.
  const open = text.split('[').length - 1;
  const close = text.split(']').length - 1;
  if (open !== close) return false;
  return !/\]\([^)]*$/.test(text);
}

/** Corta a lo más `maxWords` sin partir `[...](...)`; quien llama añade el `...`. */
function cutWords(text: string, maxWords: number): string {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length <= maxWords) return text;
  const kept = words.slice(0, maxWords);
  // Solo se retrocede si el texto original estaba equilibrado: con corchetes
  // sueltos en el propio texto el corte no tiene nada que respetar.
  if (linksBalanced(words.join(' '))) {
    while (kept.length > 1 && !linksBalanced(kept.join(' '))) kept.pop();
  }
  return kept.join(' ');
}

type OpenCodeFence = { char: string; len: number } | undefined;

/** Valla de código: la apertura que sigue abierta tras leer `line`. */
function trackCodeFence(open: OpenCodeFence, line: string): OpenCodeFence {
  const fence = CODE_FENCE_RE.exec(line);
  if (!fence) return open;
  const marker = fence[1] ?? '';
  const char = marker.charAt(0);
  if (open === undefined) return { char, len: marker.length };
  const closes = open.char === char && marker.length >= open.len && (fence[2] ?? '').trim() === '';
  return closes ? undefined : open;
}

/** Divs anidados: un cierre de al menos los colons del último los va cerrando. */
function trackDiv(openDivs: number[], line: string): void {
  const top = openDivs[openDivs.length - 1];
  const closer = DIV_CLOSER_RE.exec(line);
  if (closer && top !== undefined && (closer[1] ?? '').length >= top) {
    openDivs.pop();
    return;
  }
  const opener = DIV_OPENER_RE.exec(line);
  if (opener) openDivs.push((opener[1] ?? '').length);
}

/** Qué quedó abierto al recorrer las líneas: código y divs, por separado. */
function scanOpenBlocks(lines: string[]): { code: OpenCodeFence; divs: number[] } {
  let code: OpenCodeFence;
  const divs: number[] = [];
  for (const line of lines) {
    if (CODE_FENCE_RE.test(line)) code = trackCodeFence(code, line);
    else trackDiv(divs, line);
  }
  return { code, divs };
}

/** Cierra lo que el recorte haya dejado abierto (bloque de código o div anidado). */
function closeOpenBlocks(lines: string[]): string[] {
  const { code, divs } = scanOpenBlocks(lines);
  const out = [...lines];
  if (code !== undefined) out.push(code.char.repeat(code.len));
  while (divs.length > 0) out.push(':'.repeat(divs.pop() ?? 3));
  return out;
}

/** Recorta el contenido de un div línea a línea (no pega encabezados con el texto). */
function truncateDivContent(contentLines: string[], maxWords: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of contentLines) {
    const words = countWords(line);
    if (used + words <= maxWords) {
      out.push(line);
      used += words;
      continue;
    }
    if (maxWords - used > 0) out.push(cutWords(line, maxWords - used));
    // El corte puede caer dentro de un bloque de código o de un div anidado:
    // se cierra antes de marcar el corte, para que `...` quede fuera.
    const closed = closeOpenBlocks(out);
    closed.push(CUT_MARK);
    return closed;
  }
  return out;
}

/** Índice del cierre de un div, respetando los divs anidados; `-1` si no cierra. */
function findDivEnd(lines: string[], start: number, colons: number): number {
  const stack: number[] = [colons];
  let i = start + 1;
  while (i < lines.length) {
    const line = lineAt(lines, i);
    if (CODE_FENCE_RE.test(line)) {
      i = skipCodeFence(lines, i);
      continue;
    }
    const top = stack[stack.length - 1] ?? colons;
    const closer = DIV_CLOSER_RE.exec(line);
    if (closer && (closer[1] ?? '').length >= top) {
      stack.pop();
      i += 1;
      if (stack.length === 0) return i - 1;
      continue;
    }
    const opener = DIV_OPENER_RE.exec(line);
    if (opener) stack.push((opener[1] ?? '').length);
    i += 1;
  }
  return -1;
}

/** Div completo: sus líneas de fence intactas y el corte solo por dentro. */
function divFragment(lines: string[], start: number, colons: number, maxWords: number): string {
  const end = findDivEnd(lines, start, colons);
  const closed = end >= 0;
  // Un div sin cierre lo cierra pandoc al final del bloque; aquí se cierra en el
  // mismo sitio para que el `::::` de la tarjeta no se lo coma.
  const content = lines.slice(start + 1, closed ? end : lines.length);
  const kept = truncateDivContent(content, maxWords);
  return [lineAt(lines, start), ...kept, closed ? lineAt(lines, end) : ':'.repeat(colons)].join('\n');
}

/** Bloque párrafo: hasta línea en blanco o apertura de otro div, sin el subrayado setext. */
function readParagraph(lines: string[], start: number): { text: string; end: number; setext: boolean } {
  const block: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lineAt(lines, i);
    if (BLANK_RE.test(line) || DIV_OPENER_RE.test(line)) break;
    block.push(line);
    i += 1;
  }
  const last = block[block.length - 1] ?? '';
  const setext = block.length > 1 && SETEXT_RE.test(last);
  if (setext) block.pop();
  return { text: block.join('\n'), end: i, setext };
}

function cutParagraph(text: string, maxWords: number): string {
  const cut = cutWords(text, maxWords);
  return cut === text ? text : `${cut} ${CUT_MARK}`;
}

/** Salta el bloque de código completo (no sirve como fragmento de texto). */
function skipCodeFence(lines: string[], start: number): number {
  const marker = CODE_FENCE_RE.exec(lineAt(lines, start))?.[1] ?? '```';
  const char = marker.charAt(0);
  let i = start + 1;
  while (i < lines.length) {
    const m = CODE_FENCE_RE.exec(lineAt(lines, i));
    if (m) {
      const fence = m[1] ?? '';
      if (fence.charAt(0) === char && fence.length >= marker.length && (m[2] ?? '').trim() === '') return i + 1;
    }
    i += 1;
  }
  return lines.length;
}

/** Salta cualquier otro bloque hasta la siguiente línea en blanco. */
function skipBlock(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length && !BLANK_RE.test(lineAt(lines, i))) i += 1;
  return i;
}

/**
 * Fragmento de `body` para su tarjeta: a un lado encabezados y blancos
 * iniciales, devuelve el primer fenced div completo o el primer párrafo,
 * recortado a lo más `maxWords` palabras. Vacío si no hay texto que mostrar.
 */
export function extractFragment(body: string, maxWords: number = COLLECTION_FRAGMENT_MAX_WORDS): string {
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lineAt(lines, i);
    if (BLANK_RE.test(line) || ATX_HEADING_RE.test(line)) {
      i += 1;
      continue;
    }
    const opener = DIV_OPENER_RE.exec(line);
    if (opener) return divFragment(lines, i, (opener[1] ?? '').length, maxWords);
    if (CODE_FENCE_RE.test(line)) {
      i = skipCodeFence(lines, i);
      continue;
    }
    if (NON_PARAGRAPH_RE.test(line)) {
      i = skipBlock(lines, i);
      continue;
    }
    const paragraph = readParagraph(lines, i);
    // un encabezado setext (`Título` + `---`) no es texto que mostrar
    if (paragraph.setext) {
      i = paragraph.end;
      continue;
    }
    return cutParagraph(paragraph.text, maxWords);
  }
  return '';
}
