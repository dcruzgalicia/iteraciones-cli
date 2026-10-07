import { copyStaticAssets } from '../builder/build-assets.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { fail, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';

export async function runAssets(cwd: string, options: { output: string }): Promise<void> {
  try {
    const outputDir = resolvePath(cwd, options.output);
    await copyStaticAssets(outputDir, cwd, await loadSiteConfig(cwd));
    logSuccess(`fonts + logo → ${options.output}`, 'assets');
  } catch (err) {
    fail('assets', err);
  }
}
