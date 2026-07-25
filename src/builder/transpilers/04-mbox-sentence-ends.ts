/**
 * Transpiler AST: envuelve las primeras 2 y últimas 2 palabras de cada
 * oración en \mbox{} con espacios reemplazados por ~, solo dentro de
 * bloques Para (párrafos).
 *
 * Se ejecuta sobre el JSON AST de pandoc (después del parseo inicial).
 * No modifica Header, CodeBlock, RawBlock ni otros tipos de bloque.
 *
 * Pipeline:
 *   markdown → string transpilers → pandoc --to json → AST transpilers
 *                                                     ↑ este
 *   → pandoc --from json --to latex → .tex intermediate
 *
 * Ejemplo:
 *   "...final de la oración. Principio de otra oración..."
 *   → "...final de \mbox{la~oración}. \mbox{Principio~de} otra oración"
 */

export const type = 'ast' as const;

// ---------------------------------------------------------------------------
// Abreviaciones que NO indican fin de oración aunque terminen en .
// ---------------------------------------------------------------------------
const ABBREVIATIONS =
  /^(dr\.|dra\.|lic\.|ing\.|mtro\.|mtra\.|prof\.|sra\.|sr\.|srta\.|sta\.|vol\.|pág\.|p\.|ej\.|vs\.|aprox\.|ed\.|trad\.|coord\.|cols\.|no\.|cap\.|art\.|sec\.|fig\.|tab\.|etc\.)$/i;

/** Retorna true si el texto termina en puntuación de fin de oración. */
function isSentenceEndPunct(text: string): boolean {
  if (text.length === 0) return false;
  const last = text[text.length - 1];
  return last === '.' || last === '!' || last === '?';
}

/**
 * Clasifica un inline según su rol para el procesamiento de oraciones:
 *   'word'      → Str con texto (posible palabra u oración)
 *   'space'     → Space o SoftBreak
 *   'word-group' → Emph, Strong, Underline, Superscript, Subscript,
 *                   SmallCaps, Span, Link, Cite (unidad que funciona
 *                   como una palabra)
 *   'skip'      → Math, RawInline, Note, Image (no modificar)
 */
function classifyInline(inline: unknown): 'word' | 'space' | 'word-group' | 'skip' {
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
function getInlineText(inline: unknown): string | null {
  if (!inline || typeof inline !== 'object') return null;
  const rec = inline as Record<string, unknown>;
  if (rec.t === 'Str') return rec.c as string;
  if (rec.t === 'Space') return ' ';
  if (rec.t === 'SoftBreak') return ' ';
  if (['Emph', 'Strong', 'Underline', 'Superscript', 'Subscript', 'SmallCaps', 'Span'].includes(rec.t as string)) {
    const content = rec.c;
    if (Array.isArray(content)) {
      return content.map(getInlineText).filter(Boolean).join('');
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Estructuras auxiliares
// ---------------------------------------------------------------------------

/** Marca un rango en el array de inlines para envolver en \mbox{}. */
interface MboxWrap {
  /** Índice del inline donde comienza el \mbox{} (primer inline del grupo que califica como palabra). */
  startIdx: number;
  /** Índice del inline donde termina (último inline del grupo). */
  endIdx: number;
}

// ---------------------------------------------------------------------------
// Procesamiento de un bloque Para
// ---------------------------------------------------------------------------

/**
 * Dada una lista de inlines de un Para, retorna una nueva lista con
 * los \mbox{} insertados.
 */
function processParaInlines(inlines: unknown[]): unknown[] {
  if (inlines.length < 4) return inlines; // no hay suficientes palabras

  // --- Paso 1: identificar fronteras de oración ---
  // Cada oración se define como un rango [start, end] en el array de inlines.
  const sentenceBounds: Array<{ start: number; end: number }> = [];
  let sentStart = 0;

  for (let i = 0; i < inlines.length; i++) {
    const inline = inlines[i];
    const classification = classifyInline(inline);
    if (classification === 'skip') continue;

    const text = getInlineText(inline);
    if (text === null) continue;

    // Si este inline termina en .!? (y no es abreviatura)...
    if (isSentenceEndPunct(text) && !ABBREVIATIONS.test(text.trim())) {
      // ... y el siguiente inline no espacio inicia con mayúscula
      const nextIdx = findNextNonSpace(inlines, i + 1);
      if (nextIdx !== -1) {
        const nextText = getInlineText(inlines[nextIdx]);
        if (nextText && /^[A-ZÁÉÍÓÚÜÑ]/.test(nextText.trim())) {
          // Fin de oración. Incluir el Str con puntuación en la oración.
          sentenceBounds.push({ start: sentStart, end: i + 1 });
          sentStart = nextIdx;
          i = nextIdx - 1; // seguir desde aquí (el bucle hará i++)
        }
      } else {
        // Última oración
        sentenceBounds.push({ start: sentStart, end: inlines.length });
      }
    }
  }

  // Si no se encontraron fronteras, tratar todo como una sola oración
  if (sentenceBounds.length === 0) {
    sentenceBounds.push({ start: 0, end: inlines.length });
  }

  // --- Paso 2: para cada oración, identificar wraps ---
  const wraps: MboxWrap[] = [];

  for (const { start, end } of sentenceBounds) {
    const wordIndices: number[] = [];

    for (let i = start; i < end; i++) {
      const classification = classifyInline(inlines[i]);
      if (classification === 'word' || classification === 'word-group') {
        wordIndices.push(i);
      }
    }

    if (wordIndices.length < 4) continue; // no wrapping necesario

    const firstTwo = wordIndices.slice(0, 2);
    const lastTwo = wordIndices.slice(-2);

    // Verificar que los wraps no se solapen (solo si la oración tiene >= 6 palabras)
    if (firstTwo[1] >= lastTwo[0]) continue; // solapamiento, saltar

    wraps.push({ startIdx: firstTwo[0], endIdx: firstTwo[1] });
    wraps.push({ startIdx: lastTwo[0], endIdx: lastTwo[1] });
  }

  // --- Paso 3: aplicar wraps generando nuevo array de inlines ---
  if (wraps.length === 0) return inlines;

  const result: unknown[] = [];
  const wrapSet = new Set(wraps.map((w) => `${w.startIdx}-${w.endIdx}`));

  let i = 0;
  while (i < inlines.length) {
    const wrap = wraps.find((w) => w.startIdx === i);
    if (wrap) {
      // Abrir \mbox{}
      result.push({ t: 'RawInline', c: ['latex', '\\mbox{'] });

      // Inlines dentro del wrap, con ~ en lugar de espacios
      for (let j = wrap.startIdx; j <= wrap.endIdx; j++) {
        if (j > wrap.startIdx && isSpace(inlines[j])) {
          result.push({ t: 'RawInline', c: ['latex', '~'] });
        } else if (!isSpace(inlines[j])) {
          result.push(inlines[j]);
        }
      }

      // Cerrar \mbox{}
      result.push({ t: 'RawInline', c: ['latex', '}'] });

      i = wrap.endIdx + 1;
    } else {
      result.push(inlines[i]);
      i++;
    }
  }

  return result;
}

function isSpace(inline: unknown): boolean {
  if (!inline || typeof inline !== 'object') return false;
  const t = (inline as Record<string, unknown>).t;
  return t === 'Space' || t === 'SoftBreak';
}

function findNextNonSpace(inlines: unknown[], fromIdx: number): number {
  for (let i = fromIdx; i < inlines.length; i++) {
    const classification = classifyInline(inlines[i]);
    if (classification !== 'space' && classification !== 'skip') return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Transformación principal del AST
// ---------------------------------------------------------------------------

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];
  if (!Array.isArray(blocks)) return ast;

  const newBlocks: unknown[] = [];

  for (const block of blocks) {
    if (block && typeof block === 'object' && (block as Record<string, unknown>).t === 'Para') {
      const para = block as Record<string, unknown>;
      const inlines = para.c as unknown[];
      if (Array.isArray(inlines)) {
        const newInlines = processParaInlines(inlines);
        newBlocks.push({ ...para, c: newInlines });
      } else {
        newBlocks.push(block);
      }
    } else {
      newBlocks.push(block);
    }
  }

  ast.blocks = newBlocks;
  return ast;
}
