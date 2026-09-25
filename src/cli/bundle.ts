import { writeBundle } from '../builder/bundle-dist.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { BuildError } from '../lib/errors.js';
import { logError, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

/**
 * #2448 — `iteraciones bundle -o <dir>` replica en la salida los insumos que un
 * rebuild necesita para repetir el build (config, preamble*, filters, bib).
 * El build lo llama al final; el `build.sh` repite este mismo comando.
 */
export async function runBundle(cwd: string, options: { output?: string }): Promise<void> {
  try {
    if (options.output === undefined || options.output === '') {
      throw new BuildError('falta --output (-o): indica el directorio de salida');
    }
    const outputDir = resolvePath(cwd, options.output);
    const targets = await writeBundle(cwd, outputDir, await loadSiteConfig(cwd));
    logSuccess(`bundle → ${options.output} (${targets.length} entradas)`, 'bundle');
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'bundle');
    process.exitCode = 1;
  }
}
