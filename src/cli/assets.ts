import { resolve } from 'node:path';
import { bundleSiteJs, copyStaticAssets } from '../builder/build-assets.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { fail, logSuccess } from '../lib/logger.js';

export async function runAssets(cwd: string, options: { output: string }): Promise<void> {
  try {
    const outputDir = resolve(cwd, options.output);
    await copyStaticAssets(outputDir, cwd, await loadSiteConfig(cwd));
    await bundleSiteJs(outputDir);
    logSuccess(`fonts + logo + JS → ${options.output}`, 'assets');
  } catch (err) {
    fail('assets', err);
  }
}
