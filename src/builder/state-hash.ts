import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { resolveDisabledPreambleConfig } from '../config/site-config.js';
import { MD_READER } from '../lib/pandoc-runner.js';
import { toolVersionLatexmk, toolVersionMagick, toolVersionMinify, toolVersionPdfToPpm } from '../lib/tool-version.js';
import { LUA_FILTERS_ROOT } from './filter-resolver.js';
import { HTML_RESOURCES_DIR, htmlResourceFiles } from './html-composer.js';
import { PKG_PREAMBLE_DIR, projectPreambleDirs } from './preamble-loader.js';
import { type FileCacheEntry, type FilterFileCache, hashString } from './state-serialize.js';

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
  if (prev !== undefined && prev.mtime === mtime && prev.size === size) {
    cacheOut[key] = prev;
    return prev.hash;
  }
  const content = await file.text();
  const entry: FileCacheEntry = { mtime, size, hash: hashString(content) };
  cacheOut[key] = entry;
  return entry.hash;
}

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

export async function hashGlobbedFiles(
  dir: string,
  glob: string,
  prevCache: Record<string, FileCacheEntry> | undefined,
  cacheOut: Record<string, FileCacheEntry>,
): Promise<string[]> {
  const parts: string[] = [];
  const files = [...new Bun.Glob(glob).scanSync({ cwd: dir, onlyFiles: true })].sort();
  for (const file of files) {
    const hash = await hashFileCached(join(dir, file), file, prevCache, cacheOut);
    if (hash === null) throw new Error(`fuente desaparecida a medio del build: ${join(dir, file)}`);
    parts.push(file, hash);
  }
  return parts;
}

async function hashSpecFiles(specs: Array<[string, string]>, prevCache: FilterFileCache | undefined, cache: FilterFileCache): Promise<string[]> {
  const parts: string[] = [];
  for (const [dir, glob] of specs) {
    try {
      parts.push(...(await hashGlobbedFiles(dir, glob, prevCache, cache)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  }
  return parts;
}

const PACKAGE_SPECS: Array<[string, string]> = [
  [LUA_FILTERS_ROOT, '**/*.lua'],
  [PKG_PREAMBLE_DIR, '*.tex'],
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
