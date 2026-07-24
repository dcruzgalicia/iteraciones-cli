import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { DiscoveryEntry } from '../cache/discovery-index.js';
import type { SiteConfig } from '../config/site-config.js';
import { convertFragment } from '../services/pandoc-runner.js';
import { buildLatexPreamble } from './latex-preamble.js';
import type { BuildReport } from './pipeline/discover.js';

/**
 * FASE 3 — Generación de formatos intermedios.
 *
 * A partir de los archivos .tex (body) ya generados en FASE 2 (tex/),
 * genera los siguientes formatos en .iteraciones/formats/:
 *
 *   formats/pdf/{dir}/{slug}/{slug}.tex   (con preamble, si pdf/latex activo)
 *   formats/html/{dir}/{slug}/index.html  (html fragment, si html/epub activo)
 *   formats/markdown/{dir}/{slug}.md      (markdown, si formato markdown activo)
 *
 * No usa allDocs ni pipelineDocs — solo trabaja con discoveryIndex y diff.json.
 */
export async function generateFormats(
  cwd: string,
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
  diff: BuildReport,
  log: (msg: string) => void,
): Promise<void> {
  const pdfActive = siteConfig.format?.pdf?.generate === true || siteConfig.format?.latex?.generate === true;
  const htmlActive = siteConfig.format?.html?.generate === true || siteConfig.format?.epub?.generate === true;
  const mdActive = siteConfig.format?.markdown?.generate === true;

  if (!pdfActive && !htmlActive && !mdActive && diff.deletedFiles.length === 0) {
    return; // Nothing to do
  }

  const cacheBase = join(cwd, '.iteraciones');

  // ── Process recent files (new/modified) ──
  for (const relPath of diff.recentFiles) {
    const entry = discoveryIndex.get(relPath);
    if (!entry) continue;

    const slug = entry.slug ?? basename(relPath, '.md');
    const dir = dirname(relPath);
    const texBodyPath = join(cacheBase, 'tex', dir, `${slug}.tex`);

    // Read the .tex body from disk (generated in FASE 2)
    let texBody: string;
    try {
      texBody = await Bun.file(texBodyPath).text();
      // Strip trailing whitespace for clean preamble splicing
      texBody = texBody.replace(/\n+$/, '');
    } catch {
      // No .tex body means this document was likely skipped during renderLatex
      continue;
    }

    // ── PDF/LaTeX: write full .tex with preamble to formats/pdf/ ──
    if (pdfActive) {
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
      const pdfDir = join(cacheBase, 'formats', 'pdf', dir, slug);
      await mkdir(pdfDir, { recursive: true });
      await Bun.write(join(pdfDir, `${slug}.tex`), fullTex);
    }

    // ── HTML: convert .tex body to html fragment in formats/html/ ──
    if (htmlActive) {
      try {
        const htmlFragment = await convertFragment(texBody, join(cwd, relPath), undefined, 'html5', 'latex-auto_identifiers');

        const htmlDir = join(cacheBase, 'formats', 'html', dir, slug);
        await mkdir(htmlDir, { recursive: true });
        await Bun.write(join(htmlDir, 'index.html'), htmlFragment);
      } catch (err) {
        process.stderr.write(`[format-generator] error al convertir ${slug}.tex a HTML: ${String(err)}\n`);
      }
    }

    // ── Markdown: convert .tex body to markdown in formats/markdown/ ──
    if (mdActive) {
      try {
        const mdContent = await convertFragment(texBody, join(cwd, relPath), undefined, 'markdown', 'latex-auto_identifiers');

        const mdDir = join(cacheBase, 'formats', 'markdown', dir);
        await mkdir(mdDir, { recursive: true });
        await Bun.write(join(mdDir, `${slug}.md`), mdContent);
      } catch (err) {
        process.stderr.write(`[format-generator] error al convertir ${slug}.tex a Markdown: ${String(err)}\n`);
      }
    }
  }

  // ── Clean up deleted files from formats/ (unconditional: all formats) ──
  for (const relPath of diff.deletedFiles) {
    const entry = discoveryIndex.get(relPath);
    const slug = entry?.slug ?? basename(relPath, '.md');
    const dir = dirname(relPath);

    // Delete from all format directories regardless of current config
    await rm(join(cacheBase, 'formats', 'pdf', dir, slug), { recursive: true, force: true }).catch(() => {});
    await rm(join(cacheBase, 'formats', 'html', dir, slug), { recursive: true, force: true }).catch(() => {});
    await rm(join(cacheBase, 'formats', 'markdown', dir, `${slug}.md`), { force: true }).catch(() => {});
  }
}
