import { collectPdf } from '../builder/export.js';
import { fail, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

export async function runCollectPdf(cwd: string, slot: string, options: { output: string }): Promise<void> {
  try {
    const output = resolvePath(cwd, options.output);
    await collectPdf(resolvePath(cwd, slot), output);
    logSuccess(`${slot} → ${options.output}`, 'pdf');
  } catch (err) {
    fail('pdf', err);
  }
}
