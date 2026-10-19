import { resolve } from 'node:path';
import { collectCover } from '../builder/export.js';
import { BuildError } from '../lib/errors.js';
import { fail, logSuccess } from '../lib/logger.js';

export async function runCover(cwd: string, png: string): Promise<void> {
  try {
    if (png === '') throw new BuildError('falta la ruta del PNG de portada');
    const pngPath = resolve(cwd, png);
    const produced = await collectCover(pngPath);
    if (produced === undefined) throw new BuildError(`no hay portada de pdftoppm pendiente en "${png}"`);
    logSuccess(`${produced} → ${png}`, 'cover');
  } catch (err) {
    fail('cover', err);
  }
}
