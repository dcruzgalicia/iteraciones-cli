import { logWarning } from '../../lib/logger.js';

/**
 * Funciones auxiliares compartidas para transpilers que operan sobre
 * el AST JSON de pandoc.
 */

/** Retorna true si un bloque Div tiene la clase indicada. */
export function hasClass(block: Record<string, unknown>, cls: string): boolean {
  const c = block.c as unknown[];
  if (!Array.isArray(c) || c.length < 2) return false;
  const attrs = c[0] as unknown[];
  if (!Array.isArray(attrs) || attrs.length < 2) return false;
  const classes = attrs[1] as string[];
  return Array.isArray(classes) && classes.includes(cls);
}

/** Retorna el contenido (c[1]) de un bloque AST. */
export function blockContent(block: Record<string, unknown>): unknown[] {
  const c = block.c as unknown[];
  return Array.isArray(c) && c.length >= 2 ? (c[1] as unknown[]) : [];
}

/**
 * Convierte una lista de bloques AST internos a LaTeX usando pandoc.
 */
export async function blocksToLatex(innerBlocks: unknown[]): Promise<string> {
  if (innerBlocks.length === 0) return '';

  const doc = JSON.stringify({
    'pandoc-api-version': [1, 23],
    meta: {},
    blocks: innerBlocks,
  });

  const proc = Bun.spawn(['pandoc', '--from', 'json', '--to', 'latex'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (!proc.stdin || typeof proc.stdin === 'number') return '';

  proc.stdin.write(doc);
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    logWarning(`pandoc falló al convertir a LaTeX: ${stderr}`, 'ast-utils');
    return '';
  }

  // Quitar wrapper pandoc
  return stdout
    .replace(/^[\s\S]*?\\begin\{document\}\s*/, '')
    .replace(/\\end\{document\}[\s\S]*?$/, '')
    .trim();
}
