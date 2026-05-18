import { PandocError } from '../errors.js';
import type { PandocPool } from './pandoc-pool.js';
import { type RunResult, run } from './run.js';

export async function checkPandoc(): Promise<string> {
  let result: RunResult;
  try {
    result = await run('pandoc', ['--version']);
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, '', '');
  }
  if (result.exitCode !== 0) throw new PandocError('pandoc no está disponible en PATH', '', result.stderr);
  // Primera línea de la salida: "pandoc X.Y.Z"
  const version = result.stdout.split('\n')[0]?.trim() ?? 'pandoc unknown';
  return version;
}

/**
 * Convierte contenido Markdown a HTML5.
 * Si se pasa un `pool`, delega en `pandoc-server` para evitar fork overhead.
 * En caso contrario, spawnea un proceso pandoc pasando el contenido por stdin.
 *
 * @param content    Contenido Markdown a convertir.
 * @param sourcePath Ruta del archivo fuente (solo para mensajes de error).
 * @param pool       Pool de pandoc-server opcional.
 */
export async function convertFragment(content: string, sourcePath: string, pool?: PandocPool): Promise<string> {
  if (pool) return pool.convert(content, sourcePath);
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(['pandoc', '--from', 'markdown', '--to', 'html5', '--no-highlight'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, sourcePath, '');
  }

  if (proc.stdin == null || typeof proc.stdin === 'number') {
    throw new PandocError('No se pudo escribir stdin de pandoc', sourcePath, '');
  }
  proc.stdin.write(content);
  proc.stdin.end();

  if (proc.stdout == null || typeof proc.stdout === 'number') {
    throw new PandocError('No se pudo leer stdout de pandoc', sourcePath, '');
  }
  if (proc.stderr == null || typeof proc.stderr === 'number') {
    throw new PandocError('No se pudo leer stderr de pandoc', sourcePath, '');
  }

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    throw new PandocError(`pandoc falló al convertir ${sourcePath}`, sourcePath, stderr);
  }
  return stdout;
}
