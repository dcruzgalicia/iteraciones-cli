import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { logWarning } from '../../lib/logger.js';
import { exec, mapWithConcurrency } from '../../lib/run.js';
import { recordSupportCommand } from '../../lib/script-recorder.js';

const COVER_TIMEOUT_MS = 30_000;

interface CoverImageEntry {
  pdfPath: string;
  pngPath: string;
}

/** El nombre de trabajo de pdftoppm, derivado de la portada final. */
function coverPrefix(pngPath: string): string {
  return `.cover-${basename(pngPath, '.png')}`;
}

/**
 * pdftoppm escribe `<dir>/.cover-<slug>-1.png`; este es el paso al nombre final
 * y la limpieza de lo que quedó al lado. Compartido con `iteraciones cover`,
 * que en el build.sh ocupa el lugar de ese `mv`.
 *
 * Devuelve el fichero que movió, o `undefined` si no había portada pendiente.
 */
export async function collectCover(pngPath: string): Promise<string | undefined> {
  const dir = dirname(pngPath);
  const prefix = coverPrefix(pngPath);
  const produced = (await readdir(dir)).find((f) => f.startsWith(prefix));
  if (produced === undefined) return undefined;
  await rename(join(dir, produced), pngPath);
  for (const f of await readdir(dir)) {
    if (f.startsWith(prefix)) await rm(join(dir, f), { force: true }).catch(() => {});
  }
  return produced;
}

export async function generateCoverImages(entries: CoverImageEntry[]): Promise<void> {
  await mapWithConcurrency(entries, Math.min(4, Math.max(1, cpus().length)), async ({ pdfPath, pngPath }) => {
    try {
      await mkdir(dirname(pngPath), { recursive: true });
      await exec('pdftoppm', ['-png', '-f', '1', '-l', '1', pdfPath, join(dirname(pngPath), coverPrefix(pngPath))], {
        timeoutMs: COVER_TIMEOUT_MS,
      });
      const produced = await collectCover(pngPath);
      if (produced === undefined) {
        logWarning(`pdftoppm no produjo la imagen de portada de "${basename(pdfPath)}"`, 'build');
        return;
      }
      recordSupportCommand('covers', join(dirname(pngPath), coverPrefix(pngPath)), ['iteraciones', 'cover', pngPath]);
    } catch {
      logWarning(`no se pudo generar la imagen de portada de "${basename(pdfPath)}" (¿pdftoppm instalado?)`, 'build');
    }
  });
}
