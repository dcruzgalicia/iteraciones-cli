import { PandocError } from '../errors.js';
import type { PandocPool } from './pandoc-pool.js';
import { type RunResult, run } from './run.js';

export interface BibOptions {
  /** Ruta absoluta al archivo .bib. */
  bibliography: string;
  /** Ruta absoluta al archivo .csl. Opcional. */
  csl?: string;
}

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
 * Cuando se pasa `bibOptions`, siempre se usa un subproceso pandoc con `--citeproc`
 * (ignorando el pool), ya que pandoc-server no soporta citeproc con archivos .bib externos.
 *
 * Cuando se pasan `luaFilters`, siempre se usa un subproceso pandoc con `--lua-filter`
 * (ignorando el pool), ya que pandoc-server no soporta filtros Lua con acceso al sistema de archivos.
 *
 * @param content    Contenido Markdown a convertir.
 * @param sourcePath Ruta del archivo fuente (solo para mensajes de error).
 * @param pool       Pool de pandoc-server opcional.
 * @param bibOptions Opciones de bibliografía para procesar citas con citeproc.
 * @param luaFilters Rutas absolutas a filtros Lua que se aplican durante la conversión.
 */
export async function convertFragment(
  content: string,
  sourcePath: string,
  pool?: PandocPool,
  bibOptions?: BibOptions,
  luaFilters?: readonly string[],
): Promise<string> {
  const args = ['pandoc', '--from', 'markdown', '--to', 'html5', '--no-highlight'];

  if (bibOptions) {
    // --citeproc requiere subproceso; pandoc-server no soporta bibliografías externas.
    args.push('--citeproc', '--bibliography', bibOptions.bibliography);
    if (bibOptions.csl) args.push('--csl', bibOptions.csl);
  }

  if (luaFilters && luaFilters.length > 0) {
    for (const filter of luaFilters) {
      args.push('--lua-filter', filter);
    }
  }

  // Usar pool solo cuando no hay bibOptions ni luaFilters activos.
  if (!bibOptions && (!luaFilters || luaFilters.length === 0) && pool) {
    return pool.convert(content, sourcePath);
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, {
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
