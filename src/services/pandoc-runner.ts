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
  const version = result.stdout.split('\n')[0]?.trim() ?? 'pandoc unknown';
  return version;
}

/**
 * Convierte contenido de un formato a otro usando pandoc.
 * Si se pasa un `pool`, delega en `pandoc-server` para evitar fork overhead.
 * NOTA: pandoc-server solo soporta conversión markdown → html5. Cuando se usa
 * `bibOptions`, `luaFilters`, `toFormat` distinto de 'html5' o `fromFormat`
 * distinto de 'markdown', se ignora el pool y se usa un subproceso directo.
 *
 * @param content    Contenido a convertir.
 * @param sourcePath Ruta del archivo fuente (solo para mensajes de error).
 * @param pool       Pool de pandoc-server opcional.
 * @param bibOptions Opciones de bibliografía para procesar citas con citeproc.
 * @param luaFilters Rutas absolutas a filtros Lua que se aplican durante la conversión.
 * @param toFormat   Formato de salida (por defecto 'html5').
 * @param fromFormat Formato de entrada (por defecto 'markdown').
 * @param extraArgs  Argumentos adicionales para pandoc (ej: ['--top-level-division', 'section']).
 */
export async function convertFragment(
  content: string,
  sourcePath: string,
  pool?: PandocPool,
  bibOptions?: BibOptions,
  luaFilters?: readonly string[],
  toFormat: string = 'html5',
  fromFormat: string = 'markdown',
  extraArgs?: readonly string[],
): Promise<string> {
  const args = ['pandoc', '--from', fromFormat, '--to', toFormat, '--no-highlight'];

  if (bibOptions) {
    args.push('--citeproc', '--bibliography', bibOptions.bibliography);
    if (bibOptions.csl) args.push('--csl', bibOptions.csl);
  }

  if (luaFilters && luaFilters.length > 0) {
    for (const filter of luaFilters) {
      args.push('--lua-filter', filter);
    }
  }

  if (extraArgs && extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  // Usar pool solo cuando no hay bibOptions ni luaFilters activos
  // y los formatos son los que soporta pandoc-server (markdown→html5).
  if (!bibOptions && (!luaFilters || luaFilters.length === 0) && pool && toFormat === 'html5' && fromFormat === 'markdown') {
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
