import { PANDOC_ERROR_CODES, PandocError } from './errors.js';
import { exec, ProcessSpawnError, ProcessTimeoutError, type RunResult } from './run.js';

/** Límite de tiempo de una invocación de pandoc: 2 minutos. */
const PANDOC_TIMEOUT_MS = 120_000;

/**
 * Reader de markdown con auto-identifiers activos (headings con `id` para el
 * TOC) y la extensión `mark` (`==texto==` → resaltado → \hl{} en LaTeX y
 * <mark> en HTML; soul se carga en 29-text-decoration.tex). Es el formato de
 * entrada de TODAS las conversiones; participa en el hash de filters para
 * invalidar las salidas cacheadas si cambia (issue #2018: vive aquí, módulo
 * de dominio de pandoc, no en un compositor).
 */
export const MD_READER = 'markdown+auto_identifiers+mark';

export interface BibOptions {
  /** Ruta absoluta al archivo .bib. */
  bibliography: string;
  /** Ruta absoluta al archivo .csl. Opcional. */
  csl?: string;
}

interface PandocOptions {
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
  /** Variables de entorno adicionales para el proceso (p. ej. rutas de helpers Lua). */
  env?: Record<string, string>;
}

export async function getPandocVersion(): Promise<string> {
  let result: RunResult;
  try {
    result = await exec('pandoc', ['--version']);
  } catch {
    throw new PandocError(
      'pandoc no está disponible en PATH. Instálalo desde https://pandoc.org/installing.html',
      '',
      '',
      PANDOC_ERROR_CODES.envMissing,
    );
  }
  if (result.exitCode !== 0) throw new PandocError('pandoc no está disponible en PATH', '', result.stderr, PANDOC_ERROR_CODES.envMissing);
  const version = result.stdout.split('\n')[0]?.trim() ?? 'pandoc unknown';
  return version;
}

/**
 * Invoca pandoc con stdin y retorna stdout. Con `outputPath`, pandoc escribe
 * el resultado al archivo y stdout queda vacío.
 * Lanza PandocError si pandoc no está disponible o el proceso falla.
 * La ejecución del proceso (spawn, pipes, timeout) la provee exec().
 */
export async function execPandoc(options: PandocOptions): Promise<string> {
  // exec() añade el comando; aquí solo los argumentos (antes el array incluía
  // 'pandoc' como argv[0] del spawn directo).
  const args = ['--from', options.from ?? 'markdown', '--to', options.to];

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

  let result: RunResult;
  try {
    result = await exec('pandoc', args, { input: options.input, timeoutMs: PANDOC_TIMEOUT_MS, env: options.env });
  } catch (err) {
    if (err instanceof ProcessSpawnError) {
      // Error esperado: pandoc no está en PATH; el mensaje accionable es más
      // útil que la causa técnica.
      throw new PandocError(
        'pandoc no está disponible en PATH. Instálalo desde https://pandoc.org/installing.html',
        options.sourcePath,
        '',
        PANDOC_ERROR_CODES.envMissing,
      );
    }
    if (err instanceof ProcessTimeoutError) {
      // Un pandoc colgado (p. ej. un filtro Lua en loop) no debe colgar el
      // build: el timeout de exec() lo terminó.
      throw new PandocError(
        `pandoc no terminó en ${PANDOC_TIMEOUT_MS / 1000}s y fue terminado. Revisa tus filtros Lua (posible loop infinito).`,
        options.sourcePath,
        '',
      );
    }
    throw err;
  }

  if (result.exitCode !== 0) {
    // El mensaje no incluye la ruta: el dispatcher la añade una sola vez.
    throw new PandocError('pandoc falló al convertir el documento', options.sourcePath, result.stderr);
  }
  return result.stdout;
}
