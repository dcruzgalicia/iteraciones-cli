import { PandocError } from '../errors.js';
import { run } from './run.js';

export async function checkPandoc(): Promise<void> {
  const result = await run('pandoc', ['--version']);
  if (result.exitCode !== 0) throw new PandocError('pandoc no está disponible en PATH', '', result.stderr);
}
