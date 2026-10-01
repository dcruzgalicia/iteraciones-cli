import { copyStaticAssets } from '../builder/build-assets.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { fail, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

/**
 * #2445 — `iteraciones assets -o <dir>` copia los dos ficheros estáticos que el
 * HTML referencia (las fuentes del paquete y el logo) al directorio de salida.
 * El logo sale de la config, la misma fuente que usó el build, así que no viaja
 * en argv.
 */
export async function runAssets(cwd: string, options: { output: string }): Promise<void> {
  try {
    const outputDir = resolvePath(cwd, options.output);
    await copyStaticAssets(outputDir, cwd, await loadSiteConfig(cwd));
    logSuccess(`fonts + logo → ${options.output}`, 'assets');
  } catch (err) {
    fail('assets', err);
  }
}
