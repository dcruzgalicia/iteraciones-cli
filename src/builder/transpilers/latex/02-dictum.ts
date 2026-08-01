import { blockContent, hasClass, inlinesToLatex } from '../_ast-utils.js';

/**
 * Transpiler AST: transforma Divs con clase .dictum al comando
 * \\dictum[author]{quote} en LaTeX, con espacio superior e inferior
 * configurables mediante atributos beforeskip y afterskip.
 *
 * Si despues de un dictum sigue un parrafo normal, le antepone
 * \\noindent para evitar sangria.
 *
 * Se ejecuta sobre el JSON AST de pandoc (despues del parseo inicial).
 *
 * Convierte:
 *   ::: {.dictum}
 *   Contenido de la cita
 *   :::
 *   → \\vspace*{0.5\\topskip}\\dictum{Contenido de la cita}\\vspace*{32pt}
 *
 *   ::: {.dictum beforeskip="1\\baselineskip" afterskip="24pt"}
 *   Contenido de la cita
 *   :::
 *   → \\vspace*{1\\baselineskip}\\dictum{Contenido de la cita}\\vspace*{24pt}
 *
 *   ::: {.dictum}
 *   Contenido de la cita
 *
 *   ::: {.author}
 *   Autor
 *   :::
 *   :::
 *   → \\vspace*{0.5\\topskip}\\dictum[Autor]{Contenido de la cita}\\vspace*{32pt}
 *
 *   Si el siguiente bloque es un parrafo:
 *   → (dictum) \\noindent Texto del parrafo sin sangria
 *
 * En lugar de convertir el contenido interno con un proceso pandoc por
 * bloque (blocksToLatex), se emiten RawInline/RawBlock de apertura y cierre
 * alrededor de los bloques internos nativos: pandoc los convierte en la misma
 * pasada, con cero procesos extra. Los RawInline se pegan al primer/último
 * párrafo para que pandoc no inserte líneas en blanco (\par) dentro del
 * argumento de \dictum, que separaría la cita del autor.
 */

export const type = 'ast' as const;

// ---------------------------------------------------------------------------
// Procesar un Div.dictum → \dictum[author]{quote} con bloques nativos
// ---------------------------------------------------------------------------

function processDictum(block: Record<string, unknown>): unknown[] {
  const content = blockContent(block);

  // Leer atributos del fenced div: {.dictum beforeskip="..." afterskip="..."}
  const c = block.c as unknown[];
  const attrs = Array.isArray(c) && c.length >= 1 ? (c[0] as unknown[]) : [];
  const kvPairs: [string, string][] = Array.isArray(attrs) && attrs.length >= 3 ? (attrs[2] as [string, string][]) : [];
  const getAttr = (key: string, fallback: string): string => (Array.isArray(kvPairs) ? kvPairs.find(([k]) => k === key)?.[1] : undefined) ?? fallback;

  const beforeskip = getAttr('beforeskip', '0.5\\topskip');
  const afterskip = getAttr('afterskip', '32pt');

  // Separar autor (Div.author) del resto del contenido
  const quoteBlocks: unknown[] = [];
  let authorLatex = '';

  for (const item of content) {
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>).t === 'Div' &&
      hasClass(item as Record<string, unknown>, 'author')
    ) {
      const authorBlocks = blockContent(item as Record<string, unknown>);
      // El autor suele ser un parrafo: convertir sus inlines sin proceso pandoc
      const allParas = authorBlocks.every((b) => typeof b === 'object' && b !== null && (b as Record<string, unknown>).t === 'Para');
      if (allParas) {
        const inlines = authorBlocks.flatMap((b) => {
          const bc = (b as Record<string, unknown>).c;
          return Array.isArray(bc) ? (bc as unknown[]) : [];
        });
        authorLatex = inlinesToLatex(inlines).trim();
      } else {
        // Autor con estructura compleja: se conserva dentro de la cita
        quoteBlocks.push(item);
      }
    } else {
      quoteBlocks.push(item);
    }
  }

  const opening = `\\vspace*{${beforeskip}}\\dictum${authorLatex ? `[${authorLatex}]` : ''}{`;
  const closing = `}\\vspace*{${afterskip}}`;

  // Sin contenido: emitir solo los RawBlocks (\dictum{})
  if (quoteBlocks.length === 0) {
    return [
      { t: 'RawBlock', c: ['latex', opening] },
      { t: 'RawBlock', c: ['latex', closing] },
    ];
  }

  const isPara = (b: unknown): boolean => typeof b === 'object' && b !== null && (b as Record<string, unknown>).t === 'Para';
  const withRawInline = (b: unknown, atStart: boolean, atEnd: boolean): unknown => {
    const para = b as Record<string, unknown>;
    const inlines = Array.isArray(para.c) ? (para.c as unknown[]) : [];
    const newInlines = [...inlines];
    if (atStart) newInlines.unshift({ t: 'RawInline', c: ['latex', opening] });
    if (atEnd) newInlines.push({ t: 'RawInline', c: ['latex', closing] });
    return { ...para, c: newInlines };
  };

  // Los RawInline de apertura/cierre se pegan al primer/último párrafo para
  // que pandoc no inserte líneas en blanco (\par) dentro del argumento de
  // \dictum, que separaría la cita del autor.
  const result: unknown[] = [];
  for (let i = 0; i < quoteBlocks.length; i++) {
    const block = quoteBlocks[i];
    if (block === undefined) continue;
    const isFirst = i === 0;
    const isLast = i === quoteBlocks.length - 1;
    if (isFirst && isLast && isPara(block)) {
      result.push(withRawInline(block, true, true));
    } else if (isFirst && isPara(block)) {
      result.push(withRawInline(block, true, false));
    } else if (isLast && isPara(block)) {
      result.push(withRawInline(block, false, true));
    } else if (isFirst && isLast) {
      result.push(block, { t: 'RawBlock', c: ['latex', opening] }, { t: 'RawBlock', c: ['latex', closing] });
    } else if (isFirst) {
      result.push(block, { t: 'RawBlock', c: ['latex', opening] });
    } else if (isLast) {
      result.push(block, { t: 'RawBlock', c: ['latex', closing] });
    } else {
      result.push(block);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Transformación principal del AST
// ---------------------------------------------------------------------------

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];

  const newBlocks: unknown[] = [];
  let lastWasDictum = false;

  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).t === 'Div' &&
      hasClass(block as Record<string, unknown>, 'dictum')
    ) {
      newBlocks.push(...processDictum(block as Record<string, unknown>));
      lastWasDictum = true;
    } else if (lastWasDictum && typeof block === 'object' && block !== null && (block as Record<string, unknown>).t === 'Para') {
      // Agregar \\noindent al primer parrafo despues de un dictum
      const para = block as Record<string, unknown>;
      const inlines = para.c as unknown[];
      if (Array.isArray(inlines)) {
        newBlocks.push({ ...para, c: [{ t: 'RawInline', c: ['latex', '\\noindent '] }, ...inlines] });
      } else {
        newBlocks.push(block);
      }
      lastWasDictum = false;
    } else {
      newBlocks.push(block);
      lastWasDictum = false;
    }
  }

  ast.blocks = newBlocks;
  return ast;
}
