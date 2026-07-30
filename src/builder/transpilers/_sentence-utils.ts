/**
 * Funciones auxiliares compartidas para transpilers de procesamiento
 * de oraciones (mbox-sentence-start, mbox-sentence-end).
 */

// ---------------------------------------------------------------------------
// Abreviaciones que NO indican fin de oración aunque terminen en .
// ---------------------------------------------------------------------------
export const ABBREVIATIONS =
  /^(dr\.|dra\.|lic\.|ing\.|mtro\.|mtra\.|prof\.|sra\.|sr\.|srta\.|sta\.|vol\.|pág\.|p\.|ej\.|vs\.|aprox\.|ed\.|trad\.|coord\.|cols\.|no\.|cap\.|art\.|sec\.|fig\.|tab\.|etc\.)$/i;

/** Retorna true si el texto termina en puntuación de fin de oración. */
export function isSentenceEndPunct(text: string): boolean {
  if (text.length === 0) return false;
  const last = text[text.length - 1];
  return last === '.' || last === '!' || last === '?';
}

/**
 * Clasifica un inline según su rol para el procesamiento de oraciones:
 *   'word'       → Str con texto
 *   'space'      → Space o SoftBreak
 *   'word-group' → Emph, Strong, Underline, etc. (unidad que funciona como palabra)
 *   'skip'       → Math, RawInline, Note, Image (no modificar)
 */
export function classifyInline(inline: unknown): 'word' | 'space' | 'word-group' | 'skip' {
  if (!inline || typeof inline !== 'object') return 'skip';
  const rec = inline as Record<string, unknown>;
  switch (rec.t) {
    case 'Str':
      return 'word';
    case 'Space':
    case 'SoftBreak':
      return 'space';
    case 'Emph':
    case 'Strong':
    case 'Underline':
    case 'Superscript':
    case 'Subscript':
    case 'SmallCaps':
    case 'Span':
    case 'Link':
    case 'Cite':
      return 'word-group';
    default:
      return 'skip';
  }
}

/** Obtiene el texto plano de un inline, recursivamente si es grupo. */
export function getInlineText(inline: unknown): string | null {
  if (!inline || typeof inline !== 'object') return null;
  const rec = inline as Record<string, unknown>;
  if (rec.t === 'Str') return rec.c as string;
  if (rec.t === 'Space') return ' ';
  if (rec.t === 'SoftBreak') return ' ';
  if (['Emph', 'Strong', 'Underline', 'Superscript', 'Subscript', 'SmallCaps', 'Span'].includes(rec.t as string)) {
    const content = rec.c;
    if (Array.isArray(content)) return content.map(getInlineText).filter(Boolean).join('');
    return null;
  }
  return null;
}

/** Marca un rango en el array de inlines para envolver en \mbox{}. */
export interface MboxWrap {
  startIdx: number;
  endIdx: number;
}

export function isSpace(inline: unknown): boolean {
  if (!inline || typeof inline !== 'object') return false;
  const t = (inline as Record<string, unknown>).t;
  return t === 'Space' || t === 'SoftBreak';
}

export function findNextNonSpace(inlines: unknown[], fromIdx: number): number {
  for (let i = fromIdx; i < inlines.length; i++) {
    const classification = classifyInline(inlines[i]);
    if (classification !== 'space' && classification !== 'skip') return i;
  }
  return -1;
}

/**
 * Encuentra las fronteras de oración en un array de inlines.
 * Cada oración se define como un rango [start, end) en el array.
 */
export function findSentenceBounds(inlines: unknown[]): Array<{ start: number; end: number }> {
  const bounds: Array<{ start: number; end: number }> = [];
  let sentStart = 0;

  for (let i = 0; i < inlines.length; i++) {
    const inline = inlines[i];
    const classification = classifyInline(inline);
    if (classification === 'skip') continue;

    const text = getInlineText(inline);
    if (text === null) continue;

    if (isSentenceEndPunct(text) && !ABBREVIATIONS.test(text.trim())) {
      const nextIdx = findNextNonSpace(inlines, i + 1);
      if (nextIdx !== -1) {
        const nextText = getInlineText(inlines[nextIdx]);
        if (nextText && /^[A-ZÁÉÍÓÚÜÑ]/.test(nextText.trim())) {
          bounds.push({ start: sentStart, end: i + 1 });
          sentStart = nextIdx;
          i = nextIdx - 1;
        }
      } else {
        bounds.push({ start: sentStart, end: inlines.length });
      }
    }
  }

  if (bounds.length === 0) {
    bounds.push({ start: 0, end: inlines.length });
  }

  return bounds;
}
