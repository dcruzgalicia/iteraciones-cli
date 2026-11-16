import { resolve } from 'node:path';
import { compileCss, copyStaticAssets } from '../builder/build-assets.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { htmlStyle, htmlStyleColor } from '../lib/html-styles.js';
import { logSuccess, runCommand } from '../lib/logger.js';

export async function runAssets(cwd: string, options: { output: string; licenses?: string }): Promise<void> {
  await runCommand('assets', async () => {
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
    const siteConfig = await loadSiteConfig(cwd);
    await copyStaticAssets(outputDir, cwd, siteConfig, licenseIcons);
    const site = siteConfig.format?.html?.site;
    const style = htmlStyle(site?.style);
    await compileCss(outputDir, htmlStyleColor(site?.style, site?.color), style, site?.theme ?? 'light');
    logSuccess(`fonts + logo + CSS → ${options.output}`, 'assets');
  });
}
