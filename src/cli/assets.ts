import { resolve } from 'node:path';
import { copyStaticAssets } from '../builder/build-assets.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { fail, logSuccess } from '../lib/logger.js';

export async function runAssets(cwd: string, options: { output: string; licenses?: string }): Promise<void> {
  try {
    const outputDir = resolve(cwd, options.output);
    const licenseIcons =
      options.licenses === undefined
        ? undefined
        : new Set(
            options.licenses
              .split(',')
              .map((name) => name.trim())
              .filter(Boolean),
          );
    await copyStaticAssets(outputDir, cwd, await loadSiteConfig(cwd), licenseIcons);
    logSuccess(`fonts + logo → ${options.output}`, 'assets');
  } catch (err) {
    fail('assets', err);
  }
}
