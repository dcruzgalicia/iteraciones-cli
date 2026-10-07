import { preparePaths } from '../builder/prepare.js';
import { BuildError } from '../lib/errors.js';
import { fail, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

export async function runPrepare(cwd: string, options: { dir?: string[]; xmp?: string[] }): Promise<void> {
  try {
    const dirs = (options.dir ?? []).map((d) => resolvePath(cwd, d));
    const xmpDirs = (options.xmp ?? []).map((d) => resolvePath(cwd, d));
    if (dirs.length === 0 && xmpDirs.length === 0) throw new BuildError('falta --dir: indica el directorio a crear');
    await preparePaths(dirs, xmpDirs);
    logSuccess(`${[...new Set([...dirs, ...xmpDirs])].length} directorio(s) preparado(s)`, 'prepare');
  } catch (err) {
    fail('prepare', err);
  }
}
