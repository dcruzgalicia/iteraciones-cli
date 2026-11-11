import { resolve } from 'node:path';
import { preparePaths } from '../builder/prepare.js';
import { BuildError } from '../lib/errors.js';
import { logSuccess, runCommand } from '../lib/logger.js';

export async function runPrepare(cwd: string, options: { dir?: string[]; xmp?: string[] }): Promise<void> {
  await runCommand('prepare', async () => {
    const dirs = (options.dir ?? []).map((d) => resolve(cwd, d));
    const xmpDirs = (options.xmp ?? []).map((d) => resolve(cwd, d));
    if (dirs.length === 0 && xmpDirs.length === 0) throw new BuildError('falta --dir: indica el directorio a crear');
    await preparePaths(dirs, xmpDirs);
    logSuccess(`${[...new Set([...dirs, ...xmpDirs])].length} directorio(s) preparado(s)`, 'prepare');
  });
}
