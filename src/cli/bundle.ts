import { writeBundle } from '../builder/bundle-dist.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { fail, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

export async function runBundle(cwd: string, options: { output: string }): Promise<void> {
  try {
    const outputDir = resolvePath(cwd, options.output);
    const targets = await writeBundle(cwd, outputDir, await loadSiteConfig(cwd));
    logSuccess(`bundle → ${options.output} (${targets.length} entradas)`, 'bundle');
  } catch (err) {
    fail('bundle', err);
  }
}
