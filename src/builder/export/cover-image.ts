import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { logWarning } from '../../lib/logger.js';
import { run } from '../../lib/run.js';

/** Timeout de una extracción de portada: pdftoppm es rápido; 30s es un límite defensivo. */
const COVER_TIMEOUT_MS = 30_000;

/** Entrada de portada: el PDF ya publicado y dónde escribir su imagen. */
export interface CoverImageEntry {
  pdfPath: string;
  pngPath: string;
}

/**
 * Genera la imagen de portada (primera página) de cada PDF ya publicado en
 * dist/. Usa `pdftoppm` (poppler): si no está en PATH o falla, se advierte y
 * el build continúa (la imagen es un extra, no bloquea el PDF).
 *
 * pdftoppm numera las páginas con un sufijo cuyo formato varía entre versiones
 * de poppler (`-1.png`, `1.png`, `-01.png`...): se genera con un prefijo
 * temporal único y se renombra el archivo producido al nombre final, sin
 * depender del formato exacto del sufijo.
 */
export async function generateCoverImages(entries: CoverImageEntry[]): Promise<void> {
  for (const { pdfPath, pngPath } of entries) {
    try {
      const dir = dirname(pngPath);
      await mkdir(dir, { recursive: true });
      const prefix = join(dir, `.cover-${basename(pngPath, '.png')}`);
      // -f 1 -l 1: solo la primera página; la portada es la página 1.
      await run('pdftoppm', ['-png', '-f', '1', '-l', '1', pdfPath, prefix], { timeoutMs: COVER_TIMEOUT_MS });
      const produced = (await readdir(dir)).find((f) => f.startsWith(basename(prefix)));
      if (produced === undefined) {
        logWarning(`pdftoppm no produjo la imagen de portada de "${basename(pdfPath)}"`, 'build');
        continue;
      }
      await rename(join(dir, produced), pngPath);
      // Defensivo: eliminar cualquier sobrante del prefijo temporal (varias
      // páginas o artefactos de una versión de poppler distinta).
      for (const f of await readdir(dir)) {
        if (f.startsWith(basename(prefix))) {
          await rm(join(dir, f), { force: true }).catch(() => {});
        }
      }
    } catch {
      // pdftoppm ausente (ENOENT) o fallo de extracción: la portada es un
      // extra, el PDF ya está publicado y el build no debe fallar por esto.
      logWarning(`no se pudo generar la imagen de portada de "${basename(pdfPath)}" (¿pdftoppm instalado?)`, 'build');
    }
  }
}
