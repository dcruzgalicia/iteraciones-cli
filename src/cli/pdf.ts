import { collectPdf } from '../builder/export/runner.js';
import { BuildError } from '../lib/errors.js';
import { logError, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

/**
 * #2445 — `iteraciones pdf collect <slot> -o <salida>` agrupa lo que antes eran
 * el `rm -f` de auxiliares y el `mv` del PDF hacia dist/. El slug de trabajo es
 * el nombre del PDF de salida, que es el mismo con el que latexmk compiló.
 */
export async function runCollectPdf(cwd: string, slot: string, options: { output?: string }): Promise<void> {
  try {
    if (options.output === undefined || options.output === '') {
      throw new BuildError('falta --output (-o): indica la ruta del PDF de salida');
    }
    const output = resolvePath(cwd, options.output);
    await collectPdf(resolvePath(cwd, slot), output);
    logSuccess(`${slot} → ${options.output}`, 'pdf');
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'pdf');
    process.exitCode = 1;
  }
}
