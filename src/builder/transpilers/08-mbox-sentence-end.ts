/**
 * Transpiler AST: envuelve en \\mbox{} la ultima palabra de cada oracion
 * (o las ultimas 3 si es la oracion final del parrafo).
 *
 * Pipeline:
 *   markdown → string transpilers → pandoc --to json → AST transpilers
 *                                                     ↑ este
 *   → pandoc --from json --to latex → .tex intermediate
 *
 * Ejemplo:
 *   "Primera oración de ejemplo. Segunda aquí. Tercera oración de ejemplo final."
 *   → "Primera oración de \\mbox{ejemplo}. Segunda \\mbox{aquí}. Tercera oración \\mbox{de ejemplo final}."
 */

import { classifyInline, findSentenceBounds, isSpace, type MboxWrap } from './_sentence-utils.js';

export const type = 'ast' as const;

function processParaInlines(inlines: unknown[]): unknown[] {
  if (inlines.length < 4) return inlines;

  // Identificar fronteras de oración
  const sentenceBounds = findSentenceBounds(inlines);

  // Para cada oración, identificar wrap de las últimas 2 palabras
  const wraps: MboxWrap[] = [];

  for (const { start, end } of sentenceBounds) {
    const wordIndices: number[] = [];
    for (let i = start; i < end; i++) {
      const classification = classifyInline(inlines[i]);
      if (classification === 'word' || classification === 'word-group') {
        wordIndices.push(i);
      }
    }

    const isLastSentence = end === inlines.length;
    const wrapCount = isLastSentence ? 3 : 1;
    const minWords = isLastSentence ? 3 : 2;

    if (wordIndices.length < minWords) continue;

    const lastWords = wordIndices.slice(-wrapCount);
    wraps.push({ startIdx: lastWords[0]!, endIdx: lastWords[lastWords.length - 1]! });
  }

  if (wraps.length === 0) return inlines;

  // Aplicar wraps
  const result: unknown[] = [];
  let i = 0;
  while (i < inlines.length) {
    const wrap = wraps.find((w) => w.startIdx === i);
    if (wrap) {
      result.push({ t: 'RawInline', c: ['latex', '\\mbox{'] });
      for (let j = wrap.startIdx; j <= wrap.endIdx; j++) {
        if (j > wrap.startIdx && isSpace(inlines[j])) {
          result.push({ t: 'RawInline', c: ['latex', ' '] });
        } else if (!isSpace(inlines[j])) {
          result.push(inlines[j]);
        }
      }
      result.push({ t: 'RawInline', c: ['latex', '}'] });
      i = wrap.endIdx + 1;
    } else {
      result.push(inlines[i]);
      i++;
    }
  }

  return result;
}

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];
  if (!Array.isArray(blocks)) return ast;

  const newBlocks: unknown[] = [];
  for (const block of blocks) {
    if (block && typeof block === 'object' && (block as Record<string, unknown>).t === 'Para') {
      const para = block as Record<string, unknown>;
      const inlines = para.c as unknown[];
      if (Array.isArray(inlines)) {
        newBlocks.push({ ...para, c: processParaInlines(inlines) });
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
