import { resolve } from 'node:path';
import { writeBundle } from '../builder/bundle-dist.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { logSuccess, runCommand } from '../lib/logger.js';

export async function runBundle(cwd: string, options: { output: string }): Promise<void> {
  await runCommand('bundle', async () => {
    const outputDir = resolve(cwd, options.output);
    const targets = await writeBundle(cwd, outputDir, await loadSiteConfig(cwd));
    logSuccess(`bundle → ${options.output} (${targets.length} entradas)`, 'bundle');
  });
}
