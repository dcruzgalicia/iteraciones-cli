import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { DiscoveryEntry } from '../cache/discovery-index.js';
import type { SiteConfig } from '../config/site-config.js';
import { convertFragment } from '../services/pandoc-runner.js';
import { buildLatexPreamble } from './latex-preamble.js';
import type { BuildReport } from './pipeline/discover.js';

/**
 * FASE 3a — Genera html/{slug}.html (fragmento con bibliografia).
 * No necesita esperar a formats/pdf/. Lee directo de tex/.
 */
export async function generateHtmlFragment(
  cwd: string,
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
  diff: BuildReport,
): Promise<void> {
  const htmlActive = siteConfig.format?.html?.generate === true || siteConfig.format?.epub?.generate === true;
  if (!htmlActive) return;

  const cacheBase = join(cwd, '.iteraciones');

  // Auto-descubrir .bib para citeproc
  const bibFiles: string[] = [];
  if (cwd) {
    try {
      const glob = new Bun.Glob('**/*.bib');
      for (const file of glob.scanSync({ cwd, absolute: true })) {
        const rel = file.replace(cwd, '').replace(/^\/+/, '');
        if (rel.startsWith('node_modules/') || rel.startsWith('.iteraciones/') || rel.startsWith('dist/') || rel.startsWith('.git/')) continue;
        bibFiles.push(file);
      }
    } catch {}
  }
  const bibOptions = bibFiles.length > 0 ? { bibliography: bibFiles[0]!, csl: join(import.meta.dir, '../../pandoc/csl/apa-7.csl') } : undefined;

  for (const relPath of diff.recentFiles) {
    const entry = discoveryIndex.get(relPath);
    if (!entry) continue;

    const slug = entry.slug ?? basename(relPath, '.md');
    const dir = dirname(relPath);
    const texBodyPath = join(cacheBase, 'tex', dir, `${slug}.tex`);

    let texBody: string;
    try {
      texBody = await Bun.file(texBodyPath).text();
    } catch {
      continue;
    }

    try {
      const htmlFragment = await convertFragment(texBody, join(cwd, relPath), bibOptions, 'html5', 'latex-auto_identifiers');
      const htmlDir = join(cacheBase, 'html', dir);
      await mkdir(htmlDir, { recursive: true });
      await Bun.write(join(htmlDir, `${slug}.html`), htmlFragment);
    } catch (err) {
      process.stderr.write(`[format-generator] error al convertir ${slug}.tex a HTML: ${String(err)}\n`);
    }
  }
}

/**
 * FASE 3b — Genera formats/pdf/{slug}.tex (full .tex con preamble).
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

/**
 * FASE 3 (completa) — Genera todos los formatos intermedios.
 * Mantenida para compatibilidad, pero usa las funciones separadas.
 */
export async function generateFormats(
  cwd: string,
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
  diff: BuildReport,
  log: (msg: string) => void,
): Promise<void> {
  await generateHtmlFragment(cwd, siteConfig, discoveryIndex, diff);
  await generateLatexPreamble(cwd, siteConfig, discoveryIndex, diff);

  // Clean up deleted files from formats/
  const cacheBase = join(cwd, '.iteraciones');
  for (const relPath of diff.deletedFiles) {
    const entry = discoveryIndex.get(relPath);
    const slug = entry?.slug ?? basename(relPath, '.md');
    const dir = dirname(relPath);
    await rm(join(cacheBase, 'formats', 'pdf', dir, `${slug}.tex`), { force: true }).catch(() => {});
    await rm(join(cacheBase, 'formats', 'html', dir, `${slug}.html`), { force: true }).catch(() => {});
    await rm(join(cacheBase, 'formats', 'html', dir, `${slug}.epub`), { force: true }).catch(() => {});
  }
}
