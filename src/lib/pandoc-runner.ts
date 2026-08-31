import { PANDOC_ERROR_CODES, PandocError } from './errors.js';
import { exec, ProcessSpawnError, ProcessTimeoutError, type RunResult } from './run.js';

const PANDOC_TIMEOUT_MS = 120_000;

export const MD_READER = 'markdown+auto_identifiers+mark';

export interface BibOptions {
  bibliography: string;
  csl?: string;
}

interface PandocOptions {
  from?: string;
  to: string;
  input: string;
  sourcePath: string;
  outputPath?: string;
  bibOptions?: BibOptions;
  extraArgs?: string[];
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

export async function execPandoc(options: PandocOptions): Promise<string> {
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
      throw new PandocError(
        'pandoc no está disponible en PATH. Instálalo desde https://pandoc.org/installing.html',
        options.sourcePath,
        '',
        PANDOC_ERROR_CODES.envMissing,
      );
    }
    if (err instanceof ProcessTimeoutError) {
      throw new PandocError(
        `pandoc no terminó en ${PANDOC_TIMEOUT_MS / 1000}s y fue terminado. Revisa tus filtros Lua (posible loop infinito).`,
        options.sourcePath,
        '',
      );
    }
    throw err;
  }

  if (result.exitCode !== 0) {
    throw new PandocError('pandoc falló al convertir el documento', options.sourcePath, result.stderr);
  }
  return result.stdout;
}
