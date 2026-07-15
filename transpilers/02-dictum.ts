/**
 * Transpiler AST: transforma Divs con clase .dictum a comandos
 * \dictum[author]{quote} en LaTeX.
 *
 * Se ejecuta sobre el JSON AST de pandoc (después del parseo inicial).
 *
 * Convierte:
 *   ::: {.dictum}
 *   Contenido de la cita
 *   :::
 *   → \dictum{Contenido de la cita}
 *
 *   ::: {.dictum}
 *   Contenido de la cita
 *
 *   ::: {.author}
 *   Autor
 *   :::
 *   :::
 *   → \dictum[Autor]{Contenido de la cita}
 */

export const type = 'ast' as const;

// ---------------------------------------------------------------------------
// Helpers AST
// ---------------------------------------------------------------------------

function hasClass(block: Record<string, unknown>, cls: string): boolean {
  const c = block.c as unknown[];
  if (!Array.isArray(c) || c.length < 2) return false;
  const attrs = c[0] as unknown[];
  if (!Array.isArray(attrs) || attrs.length < 2) return false;
  const classes = attrs[1] as string[];
  return Array.isArray(classes) && classes.includes(cls);
}

function blockContent(block: Record<string, unknown>): unknown[] {
  const c = block.c as unknown[];
  return Array.isArray(c) && c.length >= 2 ? (c[1] as unknown[]) : [];
}

// ---------------------------------------------------------------------------
// Conversión de bloques a LaTeX vía pandoc
// ---------------------------------------------------------------------------

async function blocksToLatex(innerBlocks: unknown[]): Promise<string> {
  if (innerBlocks.length === 0) return '';

  const doc = JSON.stringify({
    'pandoc-api-version': [1, 23],
    meta: {},
    blocks: innerBlocks,
  });

  const proc = Bun.spawn(['pandoc', '--from', 'json', '--to', 'latex', '--syntax-highlighting=none'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (!proc.stdin || typeof proc.stdin === 'number') return '';

  proc.stdin.write(doc);
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    process.stderr.write(`[dictum] pandoc falló al convertir a LaTeX: ${stderr}\n`);
    return '';
  }

  // Quitar wrapper pandoc
  return stdout
    .replace(/^[\s\S]*?\\begin\{document\}\s*/, '')
    .replace(/\\end\{document\}[\s\S]*?$/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Procesar un Div.dictum → \dictum[author]{quote}
// ---------------------------------------------------------------------------

async function processDictum(block: Record<string, unknown>): Promise<unknown> {
  const content = blockContent(block);

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

  // Colapsar whitespace: soft breaks dentro de parrafos → espacio,
  // saltos entre parrafos preservados
  const PAR_MARKER = '@@PAR@@';
  const clean = (s: string): string =>
    s.replace(/\n\n+/g, PAR_MARKER).replace(/\n/g, ' ').replace(new RegExp(PAR_MARKER, 'g'), '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');

  const quote = clean(quoteLatex);
  const author = clean(authorLatex);

  const cmd = author ? `\\dictum[${author}]{${quote}}` : `\\dictum{${quote}}`;

  return { t: 'RawBlock', c: ['latex', cmd] };
}

// ---------------------------------------------------------------------------
// Transformación principal del AST
// ---------------------------------------------------------------------------

export async function transform(ast: Record<string, unknown>): Promise<Record<string, unknown>> {
  const blocks = ast.blocks as unknown[];

  const newBlocks: unknown[] = [];

  for (const block of blocks) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).t === 'Div' &&
      hasClass(block as Record<string, unknown>, 'dictum')
    ) {
      newBlocks.push(await processDictum(block as Record<string, unknown>));
    } else {
      newBlocks.push(block);
    }
  }

  ast.blocks = newBlocks;
  return ast;
}
