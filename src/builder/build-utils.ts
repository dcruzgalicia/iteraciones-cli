import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { buildLatexPreamble } from './latex-preamble.js';
import type { DiscoveryEntry } from './types.js';

// ── LaTeX preamble generator ──────────────────────────────────────────────

export async function generateLatexPreamble(
  cwd: string,
  siteConfig: SiteConfig,
  discoveryIndex: Map<string, DiscoveryEntry>,
  recentFiles: string[],
): Promise<void> {
  const pdfActive = siteConfig.format?.pdf?.generate === true || siteConfig.format?.latex === true;
  if (!pdfActive) return;
  const cacheBase = join(cwd, '.iteraciones');
  for (const relPath of recentFiles) {
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
    // Flags de preámbulo: desde flags.json (calculados del AST en render.ts).
    // El fallback por regex (detectFlagsFromLatex) se eliminó: writeCachedArtifacts
    // escribe el .tex y flags.json juntos, así que si el body existe, los flags
    // deben existir. Un flags.json ausente o inválido es un estado inconsistente
    // del caché y el build debe fallar con un error claro.
    const flagsPath = join(cacheBase, 'tex', dir, `${slug}.flags.json`);
    let flags: { hasTocEntries: boolean; skipNoIndent: boolean; skipParagraphSpace: boolean };
    try {
      flags = JSON.parse(await Bun.file(flagsPath).text()) as typeof flags;
    } catch (err) {
      throw new Error(`flags.json no encontrado o inválido para "${relPath}" (${flagsPath}): ${String(err)}`);
    }
    const { hasTocEntries, skipNoIndent, skipParagraphSpace } = flags;
    // Si el primer bloque es un parrafo, anteponer \noindent
    if (!skipNoIndent) {
      texBody = '\\noindent ' + texBody.trimStart();
    }
    const preamble = await buildLatexPreamble(
      siteConfig.format?.pdf,
      {
        title: entry.title,
        subtitle: entry.subtitle,
        author: entry.author,
        date: entry.date,
        filePath: join(cwd, relPath),
        cwd,
        hasTocEntries,
        skipNoIndent,
        skipParagraphSpace,
      },
      siteConfig.disabledPreambleFilters,
    );
    const fullTex = [...preamble, '', texBody, '', '\\end{document}'].join('\n');
    const pdfDir = join(cacheBase, 'formats', 'pdf', dir);
    await mkdir(pdfDir, { recursive: true });
    await Bun.write(join(pdfDir, `${slug}.tex`), fullTex);
  }
}
