import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { resolveDisabledPreambleConfig } from '../config/site-config.js';
import { MD_READER } from '../lib/pandoc-runner.js';
import { toolVersionLatexmk, toolVersionMagick, toolVersionMinify, toolVersionPdfToPpm } from '../lib/tool-version.js';
import { htmlResourceFiles } from './html-composer.js';
import { projectPreambleDirs } from './preamble-loader.js';
import { type FileCacheEntry, type FilterFileCache, hashString } from './state-serialize.js';

export function cacheHitFor(prev: FileCacheEntry | undefined, mtime: number, size: number): string | null {
  if (prev && prev.mtime === mtime && prev.size === size) return prev.hash;
  return null;
}

export async function hashFileCached(
  abs: string,
  key: string,
  prevCache: Record<string, FileCacheEntry> | undefined,
  cacheOut: Record<string, FileCacheEntry>,
): Promise<string | null> {
  const file = Bun.file(abs);
  let mtime: number;
  let size: number;
  try {
    const st = await file.stat();
    mtime = Math.round(st.mtimeMs);
    size = st.size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
  const prev = prevCache?.[key];
  const hit = cacheHitFor(prev, mtime, size);
  if (prev !== undefined && hit !== null) {
    cacheOut[key] = prev;
    return hit;
  }
  const content = await file.text();
  const entry: FileCacheEntry = { mtime, size, hash: hashString(content) };
  cacheOut[key] = entry;
  return entry.hash;
}

const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

const SCHEMA_SOURCE_GLOB = '**/*.ts';

function schemaSourceFiles(): string[] {
  const root = join(import.meta.dir, '..');
  return [...new Bun.Glob(SCHEMA_SOURCE_GLOB).scanSync({ cwd: root })].filter((file) => !file.startsWith('test/')).sort();
}

async function computeSchemaSourceHash(prevCache?: Record<string, FileCacheEntry>, cacheOut: Record<string, FileCacheEntry> = {}): Promise<string> {
  const parts: string[] = [];
  for (const file of schemaSourceFiles()) {
    const hash = await hashFileCached(join(import.meta.dir, '..', file), file, prevCache, cacheOut);
    parts.push(file, hash ?? '');
  }
  return hashString(parts.join('\0'));
}

async function hashSpecFiles(specs: Array<[string, string]>, prevCache: FilterFileCache | undefined, cache: FilterFileCache): Promise<string[]> {
  const parts: string[] = [];
  for (const [dir, glob] of specs) {
    try {
      const files = [...new Bun.Glob(glob).scanSync({ cwd: dir })].sort();
      for (const file of files) {
        const hash = await hashFileCached(join(dir, file), file, prevCache, cache);
        if (hash === null) throw new Error(`fuente desaparecida a medio del build: ${join(dir, file)}`);
        parts.push(file, hash);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  }
  return parts;
}

const PACKAGE_SPECS: Array<[string, string]> = [
  [join(import.meta.dir, '../lib/resources/filters'), '**/*.lua'],
  [join(import.meta.dir, '../lib/resources/preamble'), '*.tex'],
];

export function projectFilterSpecs(cwd: string): Array<[string, string]> {
  return [[join(cwd, 'filters'), '**/*.lua'], ...projectPreambleDirs().map((dir): [string, string] => [join(cwd, dir), '*.tex'])];
}

export async function computeFiltersHash(
  cwd: string,
  siteConfig: SiteConfig,
  prevCache?: FilterFileCache,
  effectiveDisabledPreamble?: string[],
  pandocVersion?: string,
  schemaPrevCache?: Record<string, FileCacheEntry>,
): Promise<{ hash: string; cache: FilterFileCache; schemaCache: Record<string, FileCacheEntry> }> {
  const parts: string[] = [];
  const cache: FilterFileCache = {};
  const schemaCache: Record<string, FileCacheEntry> = {};
  const specs: Array<[string, string]> = [...PACKAGE_SPECS, ...projectFilterSpecs(cwd)];
  parts.push(...(await hashSpecFiles(specs, prevCache, cache)));
  for (const rel of siteConfig.luaFilters ?? []) {
    const content = (await hashFileCached(join(cwd, rel), rel, prevCache, cache)) ?? '';
    parts.push(rel, content);
  }
  parts.push(JSON.stringify(siteConfig.disabledFilters ?? []));
  parts.push(JSON.stringify(effectiveDisabledPreamble ?? resolveDisabledPreambleConfig(siteConfig)));
  parts.push(MD_READER);
  if (pandocVersion) parts.push('pandoc', pandocVersion);
  parts.push('schema', await computeSchemaSourceHash(schemaPrevCache, schemaCache));
  return { hash: hashString(parts.join('\0')), cache, schemaCache };
}

async function resourceHash(
  abs: string,
  key: string,
  prevCache: Record<string, FileCacheEntry> | undefined,
  cacheOut: Record<string, FileCacheEntry>,
): Promise<string> {
  return (await hashFileCached(abs, key, prevCache, cacheOut)) ?? '';
}

function computeFormatHash(configStr: string, extras: string[]): string {
  return hashString([configStr, ...extras].join('\n'));
}

export async function computeConfigHashes(
  cwd: string,
  siteConfig: SiteConfig,
  prevFileCache?: Record<string, FileCacheEntry>,
  fileCacheOut: Record<string, FileCacheEntry> = {},
): Promise<{ hashes: Record<string, string>; cache: Record<string, FileCacheEntry> }> {
  const fmt = siteConfig.format;
  const htmlResources = (
    await Promise.all(htmlResourceFiles().map((rel) => resourceHash(join(HTML_RESOURCES_DIR, rel), `html-res:${rel}`, prevFileCache, fileCacheOut)))
  ).join('\n');
  const logoPath = fmt?.html?.site?.logo?.trim();
  const logo = logoPath ? await resourceHash(join(cwd, logoPath), 'html-res:logo', prevFileCache, fileCacheOut) : '';
  const toc = String(siteConfig.toc ?? false);
  const lang = String(siteConfig.language ?? '');
  const [magick, pdftoppm, latexmk, minify] = await Promise.all([
    toolVersionMagick(),
    toolVersionPdfToPpm(),
    toolVersionLatexmk(),
    toolVersionMinify(),
  ]);
  const hashes = {
    pdf: computeFormatHash(JSON.stringify(fmt?.pdf ?? {}), [String(fmt?.latex?.generate ?? false), toc, lang, latexmk, pdftoppm]),
    html: computeFormatHash(JSON.stringify(fmt?.html ?? {}), [
      htmlResources,
      logo,
      toc,
      String(fmt?.pdf?.generate ?? false),
      String(fmt?.latex?.generate ?? false),
      String(fmt?.epub?.generate ?? false),
      String(fmt?.markdown?.generate ?? false),
      lang,
      minify,
      magick,
    ]),
    epub: computeFormatHash(JSON.stringify(fmt?.epub ?? {}), [toc, lang]),
    markdown: computeFormatHash(JSON.stringify(fmt?.markdown ?? {}), [lang]),
  };
  return { hashes, cache: fileCacheOut };
}
