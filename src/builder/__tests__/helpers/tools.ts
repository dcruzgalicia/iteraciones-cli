import { run } from '../../../services/run.js';

/** Retorna `true` si pandoc está disponible en PATH y responde con exit code 0. */
export async function isPandocAvailable(): Promise<boolean> {
  try {
    const result = await run('pandoc', ['--version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Retorna la primera línea de `pandoc --version` como string.
 * Si pandoc no está disponible retorna `'unknown'`.
 */
export async function getPandocVersion(): Promise<string> {
  try {
    const result = await run('pandoc', ['--version']);
    return result.stdout.split('\n')[0]?.trim() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Retorna `true` si xelatex está disponible en PATH y responde con exit code 0. */
export async function isXelatexAvailable(): Promise<boolean> {
  try {
    const result = await run('xelatex', ['--version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
