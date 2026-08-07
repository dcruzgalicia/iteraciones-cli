import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { SiteConfig } from '../config/site-config.js';
import { logWarning } from '../lib/logger.js';
import type { BibOptions } from '../lib/pandoc-runner.js';
import { isHiddenPath, isIgnoredByRules, loadGitignoreRules } from './gitignore.js';
import type { BuildDocument, DiscoveryEntry, PreambleFlags } from './types.js';

/** Ruta relativa del archivo de estado del build dentro del proyecto. */
const STATE_PATH = join('.iteraciones', 'changes', 'state.json');

/** Plantilla HTML del paquete (participa en la invalidación del formato HTML). */
const TEMPLATE_PATH = join(import.meta.dir, '../../src/lib/resources/template.html');

/** Entrada de caché de archivo de filtro (mtime+size evitan re-leer contenido). */
interface FilterFileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export type FilterFileCache = Record<string, FilterFileCacheEntry>;

/** Contenido completo de state.json (caché content-addressed del build). */
export interface StateFile {
  startedAt: number;
  activeFormats: string[];
  /** Hash de los filters efectivos (paquete + proyecto) y sus disabled lists. */
  filtersHash?: string;
  /** Caché por archivo de filtro (mtime+size+hash) para evitar re-leer contenido. */
  filterFileCache?: FilterFileCache;
  /** Hash de configuración por formato (pdf, html, epub, markdown). */
  configHashes?: Record<string, string>;
  /** Hash de los archivos .bib y .csl del proyecto. */
  bibHash?: string;
  /** Hash de los inputs del CSS (acento + estilos base) para decidir si regenerar Tailwind. */
  cssInputHash?: string;
  /** Índice de descubrimiento: path relativo → entry con frontmatter y caché. */
  entries: Record<string, DiscoveryEntry>;
}

export function hashString(input: string): string {
  return Bun.CryptoHasher.hash('sha256', input, 'hex');
}

async function hashFileContent(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return Bun.CryptoHasher.hash('sha256', bytes, 'hex');
}

export async function loadStateFile(cwd: string): Promise<StateFile | null> {
  const file = Bun.file(join(cwd, STATE_PATH));
  if (!(await file.exists())) return null;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<StateFile>;
    if (typeof parsed.startedAt !== 'number') return null;
    return {
      startedAt: parsed.startedAt,
      activeFormats: Array.isArray(parsed.activeFormats) ? parsed.activeFormats : [],
      filtersHash: parsed.filtersHash,
      filterFileCache: parsed.filterFileCache,
      configHashes: parsed.configHashes,
      bibHash: parsed.bibHash,
      cssInputHash: parsed.cssInputHash,
      entries: (parsed.entries ?? {}) as Record<string, DiscoveryEntry>,
    };
  } catch (err) {
    // state.json corrupto (build interrumpido a mitad de escritura): se ignora y se hará build completo
    logWarning(`no se pudo leer state.json; se hará build completo: ${String(err)}`, 'cache');
    return null;
  }
}

/**
 * Guarda state.json de forma atómica (temp + rename): un build interrumpido
 * nunca deja el caché a medias.
 */
export async function saveStateFile(cwd: string, state: StateFile): Promise<void> {
  const filePath = join(cwd, STATE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(state));
  try {
    await rename(tmpPath, filePath);
  } catch {
    // El destino ya existe en algunos sistemas (Windows): se elimina y se reintenta el rename
    await rm(filePath, { force: true });
    await rename(tmpPath, filePath);
  }
}

/**
 * Hash de los filters efectivos (paquete + proyecto) y de los preamble
 * filters, incluyendo las disabled lists. Cambia solo si el código de un
 * filter o la lista de desactivados cambia.
 *
 * Con `prevCache` (de state.json), cada archivo se compara por mtime+size:
 * si no cambió, se reutiliza su hash sin leer el contenido (mismo patrón
 * content-addressed que discover usa para los documentos).
 */
export async function computeFiltersHash(
  cwd: string,
  siteConfig: SiteConfig,
  prevCache?: FilterFileCache,
): Promise<{ hash: string; cache: FilterFileCache }> {
  const parts: string[] = [];
  const cache: FilterFileCache = {};
  // [directorio, glob]: filtros Lua del paquete y del proyecto, preamble .tex
  const specs: Array<[string, string]> = [
    [join(import.meta.dir, '../lib/resources/filters'), '**/*.lua'],
    [join(import.meta.dir, '../lib/resources/preamble'), '*.tex'],
    [join(cwd, 'filters'), '**/*.lua'],
    [join(cwd, 'preamble'), '*.tex'],
  ];
  for (const [dir, glob] of specs) {
    try {
      const files = [...new Bun.Glob(glob).scanSync({ cwd: dir })].sort();
      for (const file of files) {
        parts.push(file, await hashFilterFile(join(dir, file), prevCache, cache));
      }
    } catch {
      // Directorio inexistente (filters/preamble del proyecto son opcionales)
    }
  }
  // Filtros Lua de usuario (`lua-filters:`) — pueden estar en cualquier directorio
  for (const rel of siteConfig.luaFilters ?? []) {
    const content = await hashFilterFile(join(cwd, rel), prevCache, cache).catch(() => '');
    parts.push(rel, content);
  }
  parts.push(JSON.stringify(siteConfig.disabledFilters ?? []));
  parts.push(JSON.stringify(siteConfig.format?.pdf?.disabledPreambleFilters ?? []));
  return { hash: hashString(parts.join('\0')), cache };
}

/** Hash del contenido de un archivo de filtro, reutilizando el caché si mtime+size coinciden. */
async function hashFilterFile(abs: string, prevCache: FilterFileCache | undefined, cache: FilterFileCache): Promise<string> {
  const stat = await Bun.file(abs).stat();
  const mtime = Math.round(stat.mtimeMs);
  const size = stat.size;
  const prev = prevCache?.[abs];
  if (prev && prev.mtime === mtime && prev.size === size) {
    cache[abs] = prev;
    return prev.hash;
  }
  const content = await Bun.file(abs).text();
  const hash = hashString(content);
  cache[abs] = { mtime, size, hash };
  return hash;
}

/**
 * Hash de configuración por formato. Cada hash agrupa solo los inputs que
 * afectan a ese formato: cambiar format.pdf no invalida los outputs HTML.
 * - pdf: format.pdf + format.latex
 * - html: format.html + template.html + bloque site + logo
 * - epub: format.epub
 * - markdown: format.markdown + lang
 */
export async function computeConfigHashes(cwd: string, siteConfig: SiteConfig): Promise<Record<string, string>> {
  const fmt = siteConfig.format;
  const htmlConfig = fmt?.html;
  const htmlTemplate = await Bun.file(TEMPLATE_PATH)
    .text()
    .catch(() => '');
  const logoPath = htmlConfig?.logo?.trim();
  const logo = logoPath ? await hashFileContent(join(cwd, logoPath)).catch(() => '') : '';
  return {
    pdf: hashString(`${JSON.stringify(fmt?.pdf ?? {})}\n${String(fmt?.latex ?? false)}`),
    html: hashString(`${JSON.stringify(fmt?.html ?? {})}\n${htmlTemplate}\n${logo}`),
    epub: hashString(`${JSON.stringify(fmt?.epub ?? {})}`),
    markdown: hashString(`${JSON.stringify(fmt?.markdown ?? {})}\n${String(siteConfig.lang ?? '')}`),
  };
}

/**
 * Descubre archivos de bibliografía del proyecto. Bun.Glob omite por defecto
 * los directorios ocultos (`.iteraciones/`, `.git/`), así que solo se excluyen
 * los directorios visibles no deseados (node_modules, dist).
 * @param extensions Extensiones a incluir (default: bib y csl).
 */
export async function discoverBibFiles(cwd: string, extensions: string[] = ['bib', 'csl']): Promise<string[]> {
  const results: string[] = [];
  const gitignoreRules = await loadGitignoreRules(cwd);
  try {
    const glob = new Bun.Glob(`**/*.{${extensions.join(',')}}`);
    for (const file of glob.scanSync({ cwd, absolute: true })) {
      const rel = file.replace(cwd, '').replace(/^[/\\]+/, '');
      const first = rel.split('/')[0];
      if (first === 'node_modules' || first === 'dist') continue;
      if (isIgnoredByRules(rel, gitignoreRules)) continue;
      if (isHiddenPath(rel)) continue;
      results.push(file);
    }
  } catch {
    // Sin archivos de bibliografía
  }
  return results.sort();
}

/** Hash del contenido de todos los .bib y .csl del proyecto. */
export async function computeBibHash(cwd: string): Promise<string> {
  const parts: string[] = [];
  for (const file of await discoverBibFiles(cwd)) {
    parts.push(
      file,
      await Bun.file(file)
        .text()
        .catch(() => ''),
    );
  }
  return hashString(parts.join('\0'));
}

/** Lee el AST canónico serializado de `.iteraciones/ast/{slug}.json`. */
export async function readAstFromCache(cwd: string, doc: BuildDocument): Promise<Record<string, unknown> | null> {
  const slug = doc.slug ?? basename(doc.relativePath, '.md');
  const dir = dirname(doc.relativePath);
  const astPath = join(cwd, '.iteraciones', 'ast', dir, `${slug}.json`);
  const raw = await Bun.file(astPath)
    .text()
    .catch(() => '');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    logWarning(`error al parsear AST en disco de ${doc.relativePath}`, 'render');
    return null;
  }
}

/** Escribe el AST canónico y los outputs cacheados según los formatos activos. */
export async function writeCachedArtifacts(
  cwd: string,
  doc: BuildDocument,
  slug: string,
  ast: Record<string, unknown>,
  processedBody?: string,
  flags?: PreambleFlags,
): Promise<void> {
  const dir = dirname(doc.relativePath);
  const cacheBase = join(cwd, '.iteraciones');
  const astDir = join(cacheBase, 'ast', dir);
  await mkdir(astDir, { recursive: true });
  await Bun.write(join(astDir, `${slug}.json`), JSON.stringify(ast));
  if (processedBody !== undefined && flags !== undefined) {
    const texDir = join(cacheBase, 'tex', dir);
    await mkdir(texDir, { recursive: true });
    await Bun.write(join(texDir, `${slug}.tex`), processedBody);
    await Bun.write(join(texDir, `${slug}.flags.json`), JSON.stringify(flags));
  }
}

/** Resuelve las opciones de bibliografía compartidas para exportaciones. */
export async function resolveBibOptions(cwd: string): Promise<{ bibFiles: string[]; bibOptions?: BibOptions }> {
  const bibFiles = cwd ? await discoverBibFiles(cwd, ['bib']) : [];
  const firstBib = bibFiles[0];
  const bibOptions = firstBib !== undefined ? { bibliography: firstBib, csl: join(import.meta.dir, '../../src/lib/resources/apa-7.csl') } : undefined;
  return { bibFiles, bibOptions };
}
