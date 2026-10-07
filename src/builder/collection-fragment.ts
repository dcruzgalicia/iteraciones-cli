export const COLLECTION_FRAGMENT_MAX_WORDS = 100;

const CUT_MARK = '...';

const BLANK_RE = /^\s*$/;
const ATX_HEADING_RE = /^ {0,3}#{1,6}(?:[ \t].*)?$/;

const DIV_OPENER_RE = /^ {0,3}(:{3,})(?:[ \t]*\{.*\})?[ \t]*$/;
const DIV_CLOSER_RE = /^ {0,3}(:{3,})[ \t]*$/;
const CODE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const NON_PARAGRAPH_RE = /^( {0,3}(?:>[ \t]?|[-+*][ \t]|\d+[.)][ \t]|={3,}[ \t]*$|-{3,}[ \t]*$|[*_]{3,}[ \t]*$|\|)|<[A-Za-z/!])/;

const SETEXT_RE = /^ {0,3}(?:=+|-{2,})[ \t]*$/;

function lineAt(lines: string[], index: number): string {
  return lines[index] ?? '';
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function linksBalanced(text: string): boolean {
  const open = text.split('[').length - 1;
  const close = text.split(']').length - 1;
  if (open !== close) return false;
  return !/\]\([^)]*$/.test(text);
}

function cutWords(text: string, maxWords: number): string {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length <= maxWords) return text;
  const kept = words.slice(0, maxWords);

  if (linksBalanced(words.join(' '))) {
    while (kept.length > 1 && !linksBalanced(kept.join(' '))) kept.pop();
  }
  return kept.join(' ');
}

type OpenCodeFence = { char: string; len: number } | undefined;

function trackCodeFence(open: OpenCodeFence, line: string): OpenCodeFence {
  const fence = CODE_FENCE_RE.exec(line);
  if (!fence) return open;
  const marker = fence[1] ?? '';
  const char = marker.charAt(0);
  if (open === undefined) return { char, len: marker.length };
  const closes = open.char === char && marker.length >= open.len && (fence[2] ?? '').trim() === '';
  return closes ? undefined : open;
}

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

function scanOpenBlocks(lines: string[]): { code: OpenCodeFence; divs: number[] } {
  let code: OpenCodeFence;
  const divs: number[] = [];
  for (const line of lines) {
    if (CODE_FENCE_RE.test(line)) code = trackCodeFence(code, line);
    else trackDiv(divs, line);
  }
  return { code, divs };
}

function closeOpenBlocks(lines: string[]): string[] {
  const { code, divs } = scanOpenBlocks(lines);
  const out = [...lines];
  if (code !== undefined) out.push(code.char.repeat(code.len));
  while (divs.length > 0) out.push(':'.repeat(divs.pop() ?? 3));
  return out;
}

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

    const closed = closeOpenBlocks(out);
    closed.push(CUT_MARK);
    return closed;
  }
  return out;
}

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

function divFragment(lines: string[], start: number, colons: number, maxWords: number): string {
  const end = findDivEnd(lines, start, colons);
  const closed = end >= 0;

  const content = lines.slice(start + 1, closed ? end : lines.length);
  const kept = truncateDivContent(content, maxWords);
  return [lineAt(lines, start), ...kept, closed ? lineAt(lines, end) : ':'.repeat(colons)].join('\n');
}

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

function skipBlock(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length && !BLANK_RE.test(lineAt(lines, i))) i += 1;
  return i;
}

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

    if (paragraph.setext) {
      i = paragraph.end;
      continue;
    }
    return cutParagraph(paragraph.text, maxWords);
  }
  return '';
}
