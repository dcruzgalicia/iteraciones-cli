import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { isDir } from '../lib/paths.js';

export const STATIC_DIR = 'static';

export async function copyStaticFiles(cwd: string, outputDir: string): Promise<void> {
  const src = join(cwd, STATIC_DIR);
  if (!(await isDir(src))) return;
  await cp(src, outputDir, { recursive: true, force: true });
}
