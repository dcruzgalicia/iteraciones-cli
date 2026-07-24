import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { type DiscoveryEntry, loadDiscoveryIndex, saveDiscoveryIndex } from '../../cache/discovery-index.js';
import { loadSlugsCounter, saveSlugsCounter } from '../../cache/slugs-cache.js';
import { IGNORED_DIRS } from '../../constants.js';
import { computeSlug } from '../slug.js';
import type { SourceDocument } from '../types.js';

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

      // Compute slug
      const slugBase = computeSlug({ title, author: authors, relativePath }) ?? basename(relativePath, '.md');

      // Check for duplicates in the same directory
      const dir = dirname(relativePath);
      const slugKey = dir === '.' ? slugBase : dir + '/' + slugBase;
      const existingSlug = discoveryIndex.get(relativePath)?.slug;

      // Determine the actual slug (with -dN if needed)
      let finalSlug = slugBase;
      const maxN = slugsCounter.get(slugKey) ?? 0;
      let n = maxN;

      if (n > 0) {
        // There are existing duplicates. Check if this file already has a slug.
        if (existingSlug) {
          finalSlug = existingSlug; // preserve existing slug
        } else {
          // New duplicate: increment counter
          n++;
          slugsCounter.set(slugKey, n);
          finalSlug = slugBase + '-d' + n;
        }
      } else {
        // Check if base slug collides with any EXISTING entry in discoveryIndex in same directory
        let hasCollision = false;
        for (const [key, entry] of discoveryIndex) {
          if (key === relativePath) continue;
          const existingDir = dirname(key);
          if (existingDir !== dir) continue;
          if (entry.slug && (entry.slug === slugBase || entry.slug.startsWith(slugBase + '-d'))) {
            hasCollision = true;
            break;
          }
        }
        if (hasCollision) {
          slugsCounter.set(slugKey, 1);
          finalSlug = slugBase + '-d1';
        }
      }

      discoveryIndex.set(relativePath, { title, author: authors, slug: finalSlug });
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
        speakers: [],
        keywords: [],
        region: '',
        block: false,
        draft: false,
        items: [],
        type: '',
      },
      body: '',
      sourceHash: '',
      mtimeMs: 0,
    };
  });
}
