import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { type DiscoveryEntry, loadDiscoveryIndex, saveDiscoveryIndex } from '../../cache/discovery-index.js';
import { IGNORED_DIRS } from '../../constants.js';
import { computeSlug } from '../slug.js';
import type { SourceDocument } from '../types.js';

export interface DiscoverOptions {
  noCache?: boolean;
}

export interface DiscoverResult {
  relativePaths: string[];
  changedPaths: Set<string>;
  buildReport: BuildReport;
  discoveryIndex: Map<string, DiscoveryEntry>;
  /** Entradas de archivos eliminados (title/author para calcular slugs). */
  deletedEntries: Map<string, DiscoveryEntry>;
}

export interface BuildReport {
  startedAt: number;
  newFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Fase 1 — discover: detecta cambios y actualiza discovery.json
 * con title/author de cada archivo.
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
  const currentSet = new Set(relativePaths);
  const changedPaths = new Set<string>();
  const newFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const deletedFiles: string[] = [];

  const thisBuildStartedAt = Date.now();

  // Leer title/author de archivos nuevos o modificados
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
    const existed = discoveryIndex.has(relativePath);

    if (isNew) {
      changedPaths.add(relativePath);
      if (existed) {
        modifiedFiles.push(relativePath);
      } else {
        newFiles.push(relativePath);
      }

      // Leer YAML frontmatter para title/author (solo archivos nuevos/modificados)
      try {
        const raw = await Bun.file(filePath).text();
        const fmMatch = FM_RE.exec(raw);
        if (fmMatch?.[1]) {
          const parsed = Bun.YAML.parse(fmMatch[1]) as Record<string, unknown>;
          if (parsed && !Array.isArray(parsed)) {
            const title = typeof parsed['title'] === 'string' ? parsed['title'] : '';
            const authors = Array.isArray(parsed['author']) ? parsed['author'].filter((a: unknown) => typeof a === 'string') : [];
            discoveryIndex.set(relativePath, { title, author: authors });
          }
        }
      } catch {
        // fallthrough — mantener datos anteriores si existen
      }
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
      if (entry) deletedEntries.set(key, entry);
    }
  }

  // Limpiar discoveryIndex de archivos eliminados
  for (const p of deletedFiles) {
    discoveryIndex.delete(p);
  }

  // Calcular slugs para todos los archivos (con resolucion de duplicados)
  const { fileToSlug } = computeAllSlugs(relativePaths, discoveryIndex);

  // Calcular slugs para eliminados (sin duplicados porque ya no existen)
  const deletedSlugs = computeDeletedSlugs(deletedEntries);

  const buildReport: BuildReport = {
    startedAt: thisBuildStartedAt,
    newFiles: newFiles.map((p) => fileToSlug.get(p) ?? basename(p, '.md')),
    modifiedFiles: modifiedFiles.map((p) => fileToSlug.get(p) ?? basename(p, '.md')),
    deletedFiles: deletedFiles.map((p) => deletedSlugs.get(p) ?? basename(p, '.md')),
  };

  await saveDiscoveryIndex(cwd, discoveryIndex);
  await saveBuildReport(cwd, buildReport);

  return { relativePaths, changedPaths, buildReport, discoveryIndex, deletedEntries };
}

const BUILD_REPORT_PATH = join('.iteraciones', 'discover', 'build-report.json');

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

/** Calcula slugs unicos por directorio con resolucion de duplicados. */
function computeAllSlugs(relativePaths: string[], discoveryIndex: Map<string, DiscoveryEntry>): { fileToSlug: Map<string, string> } {
  const fileToSlug = new Map<string, string>();
  const slugCount = new Map<string, number>();
  const allSlugs: string[] = [];

  // Primera pasada: calcular slugs base
  for (const p of relativePaths) {
    const entry = discoveryIndex.get(p);
    const base = entry ? (computeSlug({ title: entry.title, author: entry.author, relativePath: p }) ?? basename(p, '.md')) : basename(p, '.md');
    const key = dirname(p) + '/' + base;
    slugCount.set(key, (slugCount.get(key) ?? 0) + 1);
    allSlugs.push(key);
  }

  const allSlugsSet = new Set(allSlugs);

  // Segunda pasada: asignar slugs con sufijo para duplicados
  for (const p of relativePaths) {
    const entry = discoveryIndex.get(p);
    let base = entry ? (computeSlug({ title: entry.title, author: entry.author, relativePath: p }) ?? basename(p, '.md')) : basename(p, '.md');
    const dir = dirname(p);
    const key = dir + '/' + base;
    const count = slugCount.get(key) ?? 0;
    if (count > 1) {
      let n = 1;
      while (allSlugsSet.has(dir + '/' + base + '-d' + n)) {
        n++;
      }
      base = base + '-d' + n;
      allSlugsSet.add(dir + '/' + base);
    }
    fileToSlug.set(p, base);
  }

  return { fileToSlug };
}

/** Calcula slugs para archivos eliminados (sin duplicados). */
function computeDeletedSlugs(deletedEntries: Map<string, DiscoveryEntry>): Map<string, string> {
  const result = new Map<string, string>();
  for (const [relPath, entry] of deletedEntries) {
    const slug = computeSlug({ title: entry.title, author: entry.author, relativePath: relPath }) ?? basename(relPath, '.md');
    result.set(relPath, slug);
  }
  return result;
}
