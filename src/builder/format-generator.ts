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
 * El orden respeta la cadena de dependencias: primero pdf/latex, luego html,
 * luego markdown. Cada formato se completa para todos los archivos antes de
 * iniciar el siguiente.
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

  // ── FASE 3a: formats/pdf/ (full .tex con preamble) ──
  if (pdfActive) {
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
      const pdfDir = join(cacheBase, 'formats', 'pdf', dir, slug);
      await mkdir(pdfDir, { recursive: true });
      await Bun.write(join(pdfDir, `${slug}.tex`), fullTex);
    }
  }

  // ── FASE 3b: formats/html/ (fragmento html desde latex) ──
  if (htmlActive) {
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
        const htmlFragment = await convertFragment(texBody, join(cwd, relPath), undefined, 'html5', 'latex-auto_identifiers');
        const htmlDir = join(cacheBase, 'formats', 'html', dir, slug);
        await mkdir(htmlDir, { recursive: true });
        await Bun.write(join(htmlDir, 'index.html'), htmlFragment);
      } catch (err) {
        process.stderr.write(`[format-generator] error al convertir ${slug}.tex a HTML: ${String(err)}\n`);
      }
    }
  }

  // ── FASE 3c: formats/markdown/ (markdown desde latex) ──
  if (mdActive) {
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

    await rm(join(cacheBase, 'formats', 'pdf', dir, slug), { recursive: true, force: true }).catch(() => {});
    await rm(join(cacheBase, 'formats', 'html', dir, slug), { recursive: true, force: true }).catch(() => {});
    await rm(join(cacheBase, 'formats', 'markdown', dir, `${slug}.md`), { force: true }).catch(() => {});
  }
}
