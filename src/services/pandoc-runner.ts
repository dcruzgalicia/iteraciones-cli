import { PandocError } from '../errors.js';
import { type RunResult, run } from './run.js';

export async function checkPandoc(): Promise<void> {
  let result: RunResult;
  try {
    result = await run('pandoc', ['--version']);
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, '', '');
  }
  if (result.exitCode !== 0) throw new PandocError('pandoc no está disponible en PATH', '', result.stderr);
}

export async function convertFragment(filePath: string): Promise<string> {
  let result: RunResult;
  try {
    result = await run('pandoc', ['--from', 'markdown', '--to', 'html5', '--no-highlight', '--', filePath]);
  } catch (err) {
    throw new PandocError(`pandoc no está disponible en PATH: ${String(err)}`, filePath, '');
  }
  if (result.exitCode !== 0) {
    throw new PandocError(`pandoc falló al convertir ${filePath}`, filePath, result.stderr);
  }
  return result.stdout;
}
