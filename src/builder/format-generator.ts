import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import type { DiscoveryEntry } from '../lib/discovery-index.js';
import type { BuildReport } from './discover.js';
import { buildLatexPreamble } from './latex-preamble.js';

/**
 * Genera formats/pdf/{slug}.tex (full .tex con preamble).
 */
export async function generateLatexPreamble(
  cwd: string,
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
  diff: BuildReport,
): Promise<void> {
  const pdfActive = siteConfig.format?.pdf?.generate === true || siteConfig.format?.latex?.generate === true;
  if (!pdfActive) return;

  const cacheBase = join(cwd, '.iteraciones');

  for (const relPath of diff.recentFiles) {
    const entry = discoveryIndex.get(relPath);
    if (!entry) continue;

    const slug = entry.slug ?? basename(relPath, '.md');
    const dir = dirname(relPath);
    const texBodyPath = join(cacheBase, 'tex', dir, `${slug}.tex`);

    let texBody: string;
    try {
      texBody = await Bun.file(texBodyPath).text();
      texBody = texBody.replace(/\n+$/, '');
    } catch {
      continue;
    }

    const preamble = await buildLatexPreamble(
      siteConfig.format?.pdf,
      {
        title: entry.title,
        author: entry.author,
        date: undefined,
        filePath: join(cwd, relPath),
        cwd,
      },
      siteConfig.disabledPreambleTranspilers,
    );

    const fullTex = [...preamble, '', texBody, '', '\\end{document}'].join('\n');
    const pdfDir = join(cacheBase, 'formats', 'pdf', dir);
    await mkdir(pdfDir, { recursive: true });
    await Bun.write(join(pdfDir, `${slug}.tex`), fullTex);
  }
}
