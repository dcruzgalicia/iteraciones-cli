import { collectCover } from '../builder/export/cover-image.js';
import { BuildError } from '../lib/errors.js';
import { logError, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

/**
 * #2445 — `iteraciones cover <png>` agrupa lo que antes eran el `mv` de la
 * portada (pdftoppm escribe `<dir>/.cover-<slug>-1.png`) y la limpieza de los
 * residuos que dejó junto al PDF.
 */
export async function runCover(cwd: string, png: string): Promise<void> {
  try {
    if (png === '') throw new BuildError('falta la ruta del PNG de portada');
    const pngPath = resolvePath(cwd, png);
    const produced = await collectCover(pngPath);
    if (produced === undefined) throw new BuildError(`no hay portada de pdftoppm pendiente en "${png}"`);
    logSuccess(`${produced} → ${png}`, 'cover');
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'cover');
    process.exitCode = 1;
  }
}
