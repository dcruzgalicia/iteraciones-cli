import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { MD_READER } from '../lib/pandoc-runner.js';
import { hashString } from './state-serialize.js';

export interface FileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

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
const HTML_RESOURCE_FILES = [
  'skeleton.html',
  'card-identity.html',
  'card-identity-footer.html',
  'card-contenido.html',
  'card-indice.html',
  'card-formatos.html',
  'card-referencias.html',
  'card-referencias-block.html',
];

interface FilterFileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export type FilterFileCache = Record<string, FilterFileCacheEntry>;

export const SCHEMA_SOURCE_FILES = [
  '../lib/date.ts', // humanDate: conversión yyyy-mm-dd → fecha legible
  './pipeline.ts', // orquestación de pools de formatos
  './pipeline-formats.ts', // procesamiento por documento: emisión de formatos y cola PDF
  './render.ts', // htmlPage: post-procesamiento de referencias
  './html-composer.ts', // htmlPage + linkCitations: template HTML y enlazado de citas
  './latex-preamble.ts', // latexTemplate: composición del template LaTeX efectivo
  './latex-composer.ts', // composición del .tex completo: markdown → latex
  './pandoc-metadata.ts', // metadatos pandoc: escape, language, title/creator/date, citas
  './xmpdata.ts', // inyección de metadatos XMP/Info en el .tex
  './export/runner.ts', // markdownExport: metadatos y rutas del export Markdown
  './export/assemble.ts', // markdownExport: ensamblado de ExportDocument
] as const;

export async function computeSchemaSourceHash(
  files: readonly string[],
  baseDir: string,
  prevCache?: Record<string, FileCacheEntry>,
  cacheOut?: Record<string, FileCacheEntry>,
): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    const hash = await hashFileCached(join(baseDir, file), file, prevCache, cacheOut ?? {}).catch(() => null);
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
        if (hash === null) throw new Error(`archivo de filters/preamble desaparecido: ${join(dir, file)}`);
        parts.push(file, hash);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  }
  return parts;
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
  const specs: Array<[string, string]> = [
    [join(import.meta.dir, '../lib/resources/filters'), '**/*.lua'],
    [join(import.meta.dir, '../lib/resources/preamble'), '*.tex'],
    [join(cwd, 'filters'), '**/*.lua'],
    [join(cwd, 'preamble'), '*.tex'],
  ];
  parts.push(...(await hashSpecFiles(specs, prevCache, cache)));
  for (const rel of siteConfig.luaFilters ?? []) {
    const content = (await hashFileCached(join(cwd, rel), rel, prevCache, cache)) ?? '';
    parts.push(rel, content);
  }
  parts.push(JSON.stringify(siteConfig.disabledFilters ?? []));
  parts.push(JSON.stringify(effectiveDisabledPreamble ?? siteConfig.format?.pdf?.disabledPreambleFilters ?? []));
  parts.push(MD_READER);
  if (pandocVersion) parts.push('pandoc', pandocVersion);
  parts.push('schema', await computeSchemaSourceHash(SCHEMA_SOURCE_FILES, import.meta.dir, schemaPrevCache, schemaCache));
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
    await Promise.all(HTML_RESOURCE_FILES.map((f) => resourceHash(join(HTML_RESOURCES_DIR, f), `html-res:${f}`, prevFileCache, fileCacheOut)))
  ).join('\n');
  const logoPath = fmt?.html?.site?.logo?.trim();
  const logo = logoPath ? await resourceHash(join(cwd, logoPath), 'html-res:logo', prevFileCache, fileCacheOut) : '';
  const toc = String(siteConfig.toc ?? false);
  const lang = String(siteConfig.language ?? '');
  const hashes = {
    pdf: computeFormatHash(JSON.stringify(fmt?.pdf ?? {}), [String(fmt?.latex?.generate ?? false), toc, lang]),
    html: computeFormatHash(JSON.stringify(fmt?.html ?? {}), [
      htmlResources,
      logo,
      toc,
      String(fmt?.pdf?.generate ?? false),
      String(fmt?.latex?.generate ?? false),
      String(fmt?.epub?.generate ?? false),
      String(fmt?.markdown?.generate ?? false),
      lang,
    ]),
    epub: computeFormatHash(JSON.stringify(fmt?.epub ?? {}), [toc, lang]),
    markdown: computeFormatHash(JSON.stringify(fmt?.markdown ?? {}), [lang]),
  };
  return { hashes, cache: fileCacheOut };
}
