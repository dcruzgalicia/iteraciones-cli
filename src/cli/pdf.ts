import { resolve } from 'node:path';
import { collectPdf } from '../builder/export.js';
import { fail, logSuccess } from '../lib/logger.js';

export async function runCollectPdf(cwd: string, slot: string, options: { output: string }): Promise<void> {
  try {
    const output = resolve(cwd, options.output);
    await collectPdf(resolve(cwd, slot), output);
    logSuccess(`${slot} → ${options.output}`, 'pdf');
  } catch (err) {
    fail('pdf', err);
  }
}
