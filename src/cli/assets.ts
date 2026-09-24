import { copyStaticAssets } from '../builder/build-assets.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { BuildError } from '../lib/errors.js';
import { logError, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

/**
 * #2445 — `iteraciones assets -o <dir>` copia los dos ficheros estáticos que el
 * HTML referencia (las fuentes del paquete y el logo) al directorio de salida.
 * El logo sale de la config, la misma fuente que usó el build, así que no viaja
 * en argv.
 */
export async function runAssets(cwd: string, options: { output?: string }): Promise<void> {
  try {
    if (options.output === undefined || options.output === '') {
      throw new BuildError('falta --output (-o): indica el directorio de salida');
    }
    const outputDir = resolvePath(cwd, options.output);
    await copyStaticAssets(outputDir, cwd, await loadSiteConfig(cwd));
    logSuccess(`fonts + logo → ${options.output}`, 'assets');
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'assets');
    process.exitCode = 1;
  }
}
