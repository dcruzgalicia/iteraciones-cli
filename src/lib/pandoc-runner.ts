import { PandocError } from './errors.js';
import { type RunResult, run } from './run.js';

export interface BibOptions {
  /** Ruta absoluta al archivo .bib. */
  bibliography: string;
  /** Ruta absoluta al archivo .csl. Opcional. */
  csl?: string;
}

export interface PandocOptions {
  /** Formato de entrada (por defecto 'markdown'). */
  from?: string;
  /** Formato de salida (requerido). */
  to: string;
  /** Contenido a convertir (se envía por stdin). */
  input: string;
  /** Ruta del archivo fuente (solo para mensajes de error). */
  sourcePath: string;
  /** Ruta de salida: pandoc escribe el resultado al archivo en lugar de stdout. */
  outputPath?: string;
  /** Opciones de bibliografía para procesar citas con citeproc. */
  bibOptions?: BibOptions;
  /** Argumentos adicionales para pandoc (ej: --lua-filter, --template). */
  extraArgs?: string[];
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
 * Invoca pandoc con stdin y retorna stdout. Con `outputPath`, pandoc escribe
 * el resultado al archivo y stdout queda vacío.
 * Lanza PandocError si pandoc no está disponible o el proceso falla.
 */
export async function runPandoc(options: PandocOptions): Promise<string> {
  const args = ['pandoc', '--from', options.from ?? 'markdown', '--to', options.to];

  if (options.bibOptions) {
    args.push('--citeproc', '--bibliography', options.bibOptions.bibliography);
    if (options.bibOptions.csl) args.push('--csl', options.bibOptions.csl);
  }

  if (options.extraArgs && options.extraArgs.length > 0) {
    args.push(...options.extraArgs);
  }

  if (options.outputPath) {
    args.push('--output', options.outputPath);
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, options.sourcePath, '');
  }

  if (proc.stdin == null || typeof proc.stdin === 'number') {
    throw new PandocError('No se pudo escribir stdin de pandoc', options.sourcePath, '');
  }
  proc.stdin.write(options.input);
  proc.stdin.end();

  if (proc.stdout == null || typeof proc.stdout === 'number') {
    throw new PandocError('No se pudo leer stdout de pandoc', options.sourcePath, '');
  }
  if (proc.stderr == null || typeof proc.stderr === 'number') {
    throw new PandocError('No se pudo leer stderr de pandoc', options.sourcePath, '');
  }

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    throw new PandocError(`pandoc falló al convertir ${options.sourcePath}`, options.sourcePath, stderr);
  }
  return stdout;
}
