/**
 * Transpiler AST: envuelve la PRIMERA palabra de cada oración en \\mbox{}, solo dentro de bloques Para (párrafos).
 * Pipeline:
 *   markdown → string transpilers → pandoc --to json → AST transpilers
 *                                                     ↑ este
 *   → pandoc --from json --to latex → .tex intermediate
 *
 * Ejemplo:
 *   "Principio de la oración. Otra oración aquí."
 *   → "\mbox{Principio} de la oración. \mbox{Otra} oración aquí."
 */

import { classifyInline, findSentenceBounds, type MboxWrap } from '../_sentence-utils.js';

export const type = 'ast' as const;

function processParaInlines(inlines: unknown[]): unknown[] {
  if (inlines.length < 4) return inlines;

  // Identificar fronteras de oración
  const sentenceBounds = findSentenceBounds(inlines);

  // Para cada oración, identificar wrap de la primera palabra
  const wraps: MboxWrap[] = [];

  for (const { start, end } of sentenceBounds) {
    const wordIndices: number[] = [];
    for (let i = start; i < end; i++) {
      const classification = classifyInline(inlines[i]);
      if (classification === 'word' || classification === 'word-group') {
        wordIndices.push(i);
      }
    }

    if (wordIndices.length < 2) continue;

    // Envolver SOLO la primera palabra
    const firstIdx = wordIndices[0];
    if (firstIdx === undefined) continue;
    wraps.push({ startIdx: firstIdx, endIdx: firstIdx });
  }

  if (wraps.length === 0) return inlines;

  // Aplicar wraps
  const result: unknown[] = [];
  let i = 0;
  while (i < inlines.length) {
    const wrap = wraps.find((w) => w.startIdx === i);
    if (wrap) {
      result.push({ t: 'RawInline', c: ['latex', '\\mbox{'] });
      result.push(inlines[i]);
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
