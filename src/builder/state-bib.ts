import { isAbsolute, join, relative } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { ConfigError } from '../lib/errors.js';
import type { BibOptions } from '../lib/pandoc-runner.js';
import { isIgnoredByRules, isInsideIgnoredDir, loadGitignoreRules } from './gitignore.js';
import { hashFileCached } from './state-hash.js';
import { hashString } from './state-serialize.js';

export async function discoverBibFiles(cwd: string, extensions: string[] = ['bib', 'csl']): Promise<string[]> {
  const results: string[] = [];
  const gitignoreRules = await loadGitignoreRules(cwd);
  try {
    const glob = new Bun.Glob(`**/*.{${extensions.join(',')}}`);
    for (const file of glob.scanSync({ cwd, absolute: true })) {
      const rel = relative(cwd, file);
      if (isInsideIgnoredDir(rel)) continue;
      if (isIgnoredByRules(rel, gitignoreRules)) continue;
      results.push(file);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  return results.sort();
}

interface BibFileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export type BibFileCache = Record<string, BibFileCacheEntry>;

export const PACKAGED_APA7_CSL = join(import.meta.dir, '../lib/resources/apa-7.csl');

async function hashBibFile(abs: string, prevCache: BibFileCache | undefined, cache: BibFileCache): Promise<string> {
  const hash = await hashFileCached(abs, abs, prevCache, cache);
  return hash ?? hashString('');
}

export async function resolveBibOptions(cwd: string, siteConfig?: SiteConfig): Promise<{ bibFiles: string[]; bibOptions?: BibOptions }> {
  const configuredBib = siteConfig?.bibliography?.trim();
  if (configuredBib) {
    const bibPath = resolveConfiguredPath(cwd, configuredBib);
    if (!(await Bun.file(bibPath).exists())) {
      throw new ConfigError(
        `iteraciones.config.yaml: bibliography: "${configuredBib}" no encontrado en el proyecto`,
        join(cwd, 'iteraciones.config.yaml'),
      );
    }
    const configuredCsl = siteConfig?.csl?.trim();
    if (configuredCsl && !(await Bun.file(resolveConfiguredPath(cwd, configuredCsl)).exists())) {
      throw new ConfigError(`iteraciones.config.yaml: csl: "${configuredCsl}" no encontrado en el proyecto`, join(cwd, 'iteraciones.config.yaml'));
    }
    const cslPath = configuredCsl ? resolveConfiguredPath(cwd, configuredCsl) : PACKAGED_APA7_CSL;
    return { bibFiles: [bibPath], bibOptions: { bibliography: bibPath, csl: cslPath } };
  }
  const bibFiles = cwd ? await discoverBibFiles(cwd, ['bib']) : [];
  const firstBib = bibFiles[0];
  return { bibFiles, bibOptions: firstBib !== undefined ? { bibliography: firstBib, csl: PACKAGED_APA7_CSL } : undefined };
}

export async function computeBibHash(
  bib: { bibFiles: string[]; bibOptions?: BibOptions },
  prevCache?: BibFileCache,
): Promise<{ hash: string; cache: BibFileCache }> {
  const parts: string[] = [];
  const cache: BibFileCache = {};
  for (const file of bib.bibFiles) {
    parts.push(file, await hashBibFile(file, prevCache, cache));
  }
  if (bib.bibOptions?.csl) {
    parts.push('csl', bib.bibOptions.csl, await hashBibFile(bib.bibOptions.csl, prevCache, cache));
  }
  return { hash: hashString(parts.join('\0')), cache };
}

export function resolveConfiguredPath(cwd: string, rel: string): string {
  return isAbsolute(rel) ? rel : join(cwd, rel);
}
