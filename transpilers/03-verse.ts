/**
 * Transpiler AST: transforma Divs con clase .verse a entorno
 * \begin{verse}...\end{verse} en LaTeX.
 *
 * Convierte:
 *   ::: {.verse}
 *   Texto del poema
 *   :::
 *   → \begin{verse}
 *       Texto del poema
 *     \end{verse}
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
    process.stderr.write(`[verse] pandoc falló al convertir a LaTeX: ${stderr}\n`);
    return '';
  }

  return stdout
    .replace(/^[\s\S]*?\\begin\{document\}\s*/, '')
    .replace(/\\end\{document\}[\s\S]*?$/, '')
    .trim();
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
      hasClass(block as Record<string, unknown>, 'verse')
    ) {
      newBlocks.push(await processVerse(block as Record<string, unknown>));
    } else {
      newBlocks.push(block);
    }
  }

  ast.blocks = newBlocks;
  return ast;
}

async function processVerse(block: Record<string, unknown>): Promise<unknown> {
  const content = blockContent(block);
  const verseLatex = await blocksToLatex(content);
  const clean = (s: string): string => s.replace(/\n\n+/g, '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');
  const verse = clean(verseLatex);

  return { t: 'RawBlock', c: ['latex', `\\begin{verse}\n${verse}\n\\end{verse}`] };
}
