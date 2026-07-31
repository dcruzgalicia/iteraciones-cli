import { blockContent, blocksToLatex, hasClass } from './_ast-utils.js';

/**
 * Transpiler AST: transforma Divs con clase .dictum a comandos
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
 */

export const type = 'ast' as const;

// ---------------------------------------------------------------------------
// Procesar un Div.dictum → \dictum[author]{quote}
// ---------------------------------------------------------------------------

async function processDictum(block: Record<string, unknown>): Promise<unknown> {
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
  let authorBlocks: unknown[] = [];

  for (const item of content) {
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as Record<string, unknown>).t === 'Div' &&
      hasClass(item as Record<string, unknown>, 'author')
    ) {
      authorBlocks = blockContent(item as Record<string, unknown>);
    } else {
      quoteBlocks.push(item);
    }
  }

  // Convertir a LaTeX
  const [quoteLatex, authorLatex] = await Promise.all([
    blocksToLatex(quoteBlocks),
    authorBlocks.length > 0 ? blocksToLatex(authorBlocks) : Promise.resolve(''),
  ]);

  // Colapsar whitespace
  const PAR_MARKER = '@@PAR@@';
  const clean = (s: string): string =>
    s.replace(/\n\n+/g, PAR_MARKER).replace(/\n/g, ' ').replace(new RegExp(PAR_MARKER, 'g'), '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');

  const quote = clean(quoteLatex);
  const author = clean(authorLatex);

  const cmd = author
    ? `\\vspace*{${beforeskip}}\\dictum[${author}]{${quote}}\\vspace*{${afterskip}}`
    : `\\vspace*{${beforeskip}}\\dictum{${quote}}\\vspace*{${afterskip}}`;

  return { t: 'RawBlock', c: ['latex', cmd] };
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
      newBlocks.push(await processDictum(block as Record<string, unknown>));
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
