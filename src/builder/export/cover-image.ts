import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { logWarning } from '../../lib/logger.js';
import { exec, mapWithConcurrency } from '../../lib/run.js';

const COVER_TIMEOUT_MS = 30_000;

interface CoverImageEntry {
  pdfPath: string;
  pngPath: string;
}

export async function generateCoverImages(entries: CoverImageEntry[]): Promise<void> {
  await mapWithConcurrency(entries, Math.min(4, Math.max(1, cpus().length)), async ({ pdfPath, pngPath }) => {
    try {
      const dir = dirname(pngPath);
      await mkdir(dir, { recursive: true });
      const prefix = join(dir, `.cover-${basename(pngPath, '.png')}`);
      await exec('pdftoppm', ['-png', '-f', '1', '-l', '1', pdfPath, prefix], { timeoutMs: COVER_TIMEOUT_MS });
      const produced = (await readdir(dir)).find((f) => f.startsWith(basename(prefix)));
      if (produced === undefined) {
        logWarning(`pdftoppm no produjo la imagen de portada de "${basename(pdfPath)}"`, 'build');
        return;
      }
      await rename(join(dir, produced), pngPath);
      for (const f of await readdir(dir)) {
        if (f.startsWith(basename(prefix))) {
          await rm(join(dir, f), { force: true }).catch(() => {});
        }
      }
    } catch {
      logWarning(`no se pudo generar la imagen de portada de "${basename(pdfPath)}" (¿pdftoppm instalado?)`, 'build');
    }
  });
}
