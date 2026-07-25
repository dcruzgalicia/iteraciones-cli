import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { computeSlug } from './slug.js';
import type { DiscoveryEntry, SourceDocument } from './types.js';

export interface DiscoverOptions {
  noCache?: boolean;
}

export interface DiscoverResult {
  relativePaths: string[];
  changedPaths: Set<string>;
  discoveryIndex: Map<string, DiscoveryEntry>;
  /** Entradas de archivos eliminados (title/author/slug para calcular slugs). */
  deletedEntries: Map<string, DiscoveryEntry>;
}

export interface BuildReport {
  startedAt: number;
  recentFiles: string[];
  deletedFiles: string[];
}

const DISCOVERY_INDEX_PATH = join('.iteraciones', 'changes', 'files.json');

async function readCliVersion(): Promise<string> {
  try {
    const pkg = (await Bun.file(join(import.meta.dir, '../../package.json')).json()) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

interface DiscoveryIndexFile {
  cliVersion: string;
  entries: Record<string, DiscoveryEntry>;
}

async function loadDiscoveryIndex(cwd: string): Promise<Map<string, DiscoveryEntry>> {
  const file = Bun.file(join(cwd, DISCOVERY_INDEX_PATH));
  if (!(await file.exists())) return new Map();
  try {
    const raw = await file.text();
    const parsed: DiscoveryIndexFile = JSON.parse(raw);
    const currentVersion = await readCliVersion();
    if (parsed.cliVersion !== currentVersion) return new Map();
    return new Map(Object.entries(parsed.entries));
  } catch {
    return new Map();
  }
}

async function saveDiscoveryIndex(cwd: string, index: Map<string, DiscoveryEntry>): Promise<void> {
  const filePath = join(cwd, DISCOVERY_INDEX_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  const cliVersion = await readCliVersion();
  const file: DiscoveryIndexFile = { cliVersion, entries: Object.fromEntries(index) };
  await Bun.write(filePath, JSON.stringify(file));
}

const SLUGS_CACHE_PATH = join('.iteraciones', 'changes', 'slugs.json');

async function loadSlugsCounter(cwd: string): Promise<Map<string, number>> {
  const file = Bun.file(join(cwd, SLUGS_CACHE_PATH));
  if (!(await file.exists())) return new Map();
  try {
    const raw = await file.text();
    const parsed: Record<string, number> = JSON.parse(raw);
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

async function saveSlugsCounter(cwd: string, counter: Map<string, number>): Promise<void> {
  const filePath = join(cwd, SLUGS_CACHE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(Object.fromEntries(counter)));
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Fase 1 — discover: detecta cambios y actualiza discovery.json
 * con title/author/slug de cada archivo.
 */
export async function discover(cwd: string, options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const relativePaths: string[] = [];

  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    relativePaths.push(entry);
  }

  relativePaths.sort();

  const useCache = !options.noCache;
  const prevReport = useCache ? await loadBuildReport(cwd) : null;
  const discoveryIndex = useCache ? await loadDiscoveryIndex(cwd) : new Map<string, DiscoveryEntry>();
  const slugsCounter = useCache ? await loadSlugsCounter(cwd) : new Map<string, number>();
  const currentSet = new Set(relativePaths);
  const changedPaths = new Set<string>();
  const recentFiles: string[] = [];
  const deletedFiles: string[] = [];

  const thisBuildStartedAt = Date.now();

  // Leer title/author de archivos nuevos o modificados y calcular slugs
  for (const relativePath of relativePaths) {
    const filePath = join(cwd, relativePath);
    let mtimeMs: number;
    try {
      const stat = await Bun.file(filePath).stat();
      mtimeMs = stat.mtime.getTime();
    } catch (err) {
      throw new Error(`Error al leer "${relativePath}": ${String(err)}`, { cause: err });
    }

    const isNew = !useCache || !prevReport || mtimeMs > prevReport.startedAt;

    if (isNew) {
      changedPaths.add(relativePath);
      recentFiles.push(relativePath);

      // Read YAML frontmatter
      let title = '',
        authors: string[] = [];
      try {
        const raw = await Bun.file(filePath).text();
        const fmMatch = FM_RE.exec(raw);
        if (fmMatch?.[1]) {
          const parsed = Bun.YAML.parse(fmMatch[1]) as Record<string, unknown>;
          if (parsed && !Array.isArray(parsed)) {
            title = typeof parsed['title'] === 'string' ? parsed['title'] : '';
            authors = Array.isArray(parsed['author']) ? parsed['author'].filter((a: unknown) => typeof a === 'string') : [];
          }
        }
      } catch {
        // fallthrough — mantener datos anteriores si existen
      }

      // Store base data (slug resolution happens later, after all files are processed)
      discoveryIndex.set(relativePath, { title, author: authors });
    }
    // Archivos sin cambios: conservan su entrada en discoveryIndex
  }

  // Detectar eliminados y capturar sus datos antes de borrarlos
  const deletedEntries = new Map<string, DiscoveryEntry>();
  for (const key of discoveryIndex.keys()) {
    if (!currentSet.has(key)) {
      changedPaths.add(key);
      deletedFiles.push(key);
      const entry = discoveryIndex.get(key);
      if (entry) deletedEntries.set(key, entry); // entry now has slug!
    }
  }

  // Limpiar discoveryIndex de archivos eliminados
  for (const p of deletedFiles) {
    discoveryIndex.delete(p);
  }

  // Resolver slugs duplicados: asignar -dN a todos los archivos con mismo slug base en mismo directorio
  const slugGroups = new Map<string, string[]>();
  for (const [relPath, entry] of discoveryIndex) {
    const slugBase = computeSlug({ title: entry.title, author: entry.author, relativePath: relPath }) ?? basename(relPath, '.md');
    const dir = dirname(relPath);
    const key = dir === '.' ? slugBase : dir + '/' + slugBase;
    if (!slugGroups.has(key)) slugGroups.set(key, []);
    slugGroups.get(key)!.push(relPath);
  }

  for (const [key, paths] of slugGroups) {
    if (paths.length <= 1) {
      // No duplicates: assign base slug
      const path = paths[0]!;
      const entry = discoveryIndex.get(path)!;
      const slugBase = computeSlug({ title: entry.title, author: entry.author, relativePath: path }) ?? basename(path, '.md');
      entry.slug = slugBase;
    } else {
      // Duplicates: assign -d1, -d2... sorted by relativePath
      paths.sort();
      let n = 1;
      for (const path of paths) {
        const entry = discoveryIndex.get(path)!;
        const slugBase = computeSlug({ title: entry.title, author: entry.author, relativePath: path }) ?? basename(path, '.md');
        entry.slug = slugBase + '-d' + n;
        n++;
      }
      slugsCounter.set(key, n - 1);
    }
  }

  const buildReport: BuildReport = {
    startedAt: thisBuildStartedAt,
    recentFiles: [...recentFiles],
    deletedFiles: [...deletedFiles],
  };

  await saveDiscoveryIndex(cwd, discoveryIndex);
  await saveBuildReport(cwd, buildReport);
  await saveSlugsCounter(cwd, slugsCounter);

  return { relativePaths, changedPaths, discoveryIndex, deletedEntries };
}

/** Directorios que el CLI ignora al escanear el proyecto. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);

const BUILD_REPORT_PATH = join('.iteraciones', 'changes', 'diff.json');

async function loadBuildReport(cwd: string): Promise<BuildReport | null> {
  const file = Bun.file(join(cwd, BUILD_REPORT_PATH));
  if (!(await file.exists())) return null;
  try {
    const raw = await file.text();
    return JSON.parse(raw) as BuildReport;
  } catch {
    return null;
  }
}

async function saveBuildReport(cwd: string, report: BuildReport): Promise<void> {
  const filePath = join(cwd, BUILD_REPORT_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(report));
}

/**
 * Construye SourceDocument[] con frontmatter desde discoveryIndex.
 * Solo title y author — el resto usa valores por defecto.
 */
export function buildDocsFromIndex(relativePaths: string[], discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): SourceDocument[] {
  return relativePaths.map((relativePath) => {
    const entry = discoveryIndex.get(relativePath);
    return {
      filePath: join(cwd, relativePath),
      relativePath,
      frontmatter: {
        title: entry?.title ?? '',
        date: '',
        author: entry?.author ?? [],
        keywords: [],
      },
      body: '',
      sourceHash: '',
      mtimeMs: 0,
    };
  });
}
