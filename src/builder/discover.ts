import { mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { mapWithConcurrency } from '../lib/run.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';

interface DiscoverResult {
  relativePaths: string[];
  changedPaths: Set<string>;
  discoveryIndex: Map<string, DiscoveryEntry>;
  /** Entradas de archivos eliminados (title/author/slug para calcular slugs). */
  deletedEntries: Map<string, DiscoveryEntry>;
  /** Archivos cuyo slug cambio (relativePath -> slug anterior). */
  slugChangedEntries: Map<string, string>;
}

export interface BuildReport {
  startedAt: number;
  recentFiles: string[];
  deletedFiles: string[];
  /** Formatos activos durante este build (para detectar formatos nuevos en el siguiente build). */
  activeFormats?: string[];
}

/**
 * Estado del build anterior, leído de state.json.
 * Combina el report (startedAt, activeFormats) con el discovery index (entries).
 */
export interface BuildState {
  /** Timestamp del build anterior. */
  startedAt: number;
  /** Formatos que estaban activos en el build anterior. */
  activeFormats: string[];
  /** Entradas del discovery index (path → title/author/slug). */
  entries: Map<string, DiscoveryEntry>;
}

const STATE_PATH = join('.iteraciones', 'changes', 'state.json');
const SLUGS_CACHE_PATH = join('.iteraciones', 'changes', 'slugs.json');

/**
 * Carga el estado del build anterior desde state.json.
 * Retorna null si no existe (primer build).
 */
export async function loadBuildState(cwd: string): Promise<BuildState | null> {
  const file = Bun.file(join(cwd, STATE_PATH));
  if (!(await file.exists())) return null;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as { startedAt: number; activeFormats: string[]; entries: Record<string, unknown> };
    return {
      startedAt: parsed.startedAt,
      activeFormats: parsed.activeFormats ?? [],
      entries: new Map(Object.entries(parsed.entries ?? {})) as Map<string, DiscoveryEntry>,
    };
  } catch {
    return null;
  }
}

/**
 * Guarda el estado del build actual en state.json.
 * Combina el report (startedAt, activeFormats) con el discovery index (entries).
 */
export async function saveBuildState(cwd: string, state: BuildState): Promise<void> {
  const filePath = join(cwd, STATE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(
    filePath,
    JSON.stringify({
      startedAt: state.startedAt,
      activeFormats: state.activeFormats,
      entries: Object.fromEntries(state.entries),
    }),
  );
}

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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function computeSlug(frontmatter: { title?: string; author?: string[] }): string | undefined {
  const title = frontmatter.title;
  if (!title) return undefined;

  const titleSlug = slugify(title);
  const authors = frontmatter.author?.filter(Boolean).slice(0, 3);

  if (!authors || authors.length === 0) return titleSlug;

  const authorSlug = authors.map((a) => slugify(a)).join('-y-');
  return `${titleSlug}-by-${authorSlug}`;
}

/**
 * Fase 1 — discover: detecta cambios y actualiza el estado del build.
 * Si se proporciona prevState (desde orchestrator), evita la segunda
 * lectura de state.json.
 */
export async function discover(
  cwd: string,
  options: { noCache?: boolean; activeFormats?: string[]; prevState?: BuildState | null } = {},
): Promise<DiscoverResult> {
  const relativePaths: string[] = [];

  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    relativePaths.push(entry);
  }

  relativePaths.sort();

  const useCache = !options.noCache;
  // Si orchestrator ya pasó el estado, no leer state.json otra vez
  const prevState = options.prevState !== undefined ? options.prevState : useCache ? await loadBuildState(cwd) : null;
  const prevReport: BuildReport | null = prevState
    ? { startedAt: prevState.startedAt, recentFiles: [], deletedFiles: [], activeFormats: prevState.activeFormats }
    : null;
  const discoveryIndex = useCache ? (prevState?.entries ?? new Map<string, DiscoveryEntry>()) : new Map<string, DiscoveryEntry>();

  const currentSet = new Set(relativePaths);
  const changedPaths = new Set<string>();
  const recentFiles: string[] = [];
  const deletedFiles: string[] = [];
  const slugChangedEntries = new Map<string, string>();

  const thisBuildStartedAt = Date.now();

  // Leer title/author de archivos nuevos o modificados y calcular slugs
  const FILE_IO_CONCURRENCY = Math.max(1, cpus().length - 1);
  await mapWithConcurrency(relativePaths, FILE_IO_CONCURRENCY, async (relativePath) => {
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
            {
              const raw = parsed['author'];
              authors = Array.isArray(raw)
                ? raw.filter((a: unknown): a is string => typeof a === 'string')
                : typeof raw === 'string' && raw.trim()
                  ? [raw.trim()]
                  : [];
            }
          }
        }
      } catch {
        // fallthrough — mantener datos anteriores si existen
      }

      // Store base data (slug resolution happens later, after all files are processed)
      // Capturar slug anterior antes de sobrescribir (para limpiar archivos si cambia)
      const prevSlug = discoveryIndex.get(relativePath)?.slug;
      if (prevSlug) {
        const newSlugBase = computeSlug({ title, author: authors });
        if (newSlugBase && prevSlug !== newSlugBase && !prevSlug.startsWith(newSlugBase + '-')) {
          slugChangedEntries.set(relativePath, prevSlug);
        }
      }
      discoveryIndex.set(relativePath, { title, author: authors });
    }
    // Archivos sin cambios: conservan su entrada en discoveryIndex
  });

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

  // Resolver slugs duplicados: asignar -dN sin renumeracion
  const slugGroups = new Map<string, string[]>();
  for (const [relPath, entry] of discoveryIndex) {
    const slugBase = computeSlug({ title: entry.title, author: entry.author }) ?? basename(relPath, '.md');
    const dir = dirname(relPath);
    const key = dir === '.' ? slugBase : dir + '/' + slugBase;
    if (!slugGroups.has(key)) slugGroups.set(key, []);
    slugGroups.get(key)!.push(relPath);
  }

  // Solo cargar contador de slugs si hay grupos duplicados
  const hasDuplicateGroups = [...slugGroups.values()].some((paths) => paths.length > 1);
  const slugsCounter = hasDuplicateGroups ? await loadSlugsCounter(cwd) : new Map<string, number>();

  for (const [key, paths] of slugGroups) {
    if (paths.length <= 1) {
      // No duplicates: assign base slug (sin -dN)
      const path = paths[0]!;
      const entry = discoveryIndex.get(path)!;
      const slugBase = computeSlug({ title: entry.title, author: entry.author }) ?? basename(path, '.md');
      // Si antes tenia un slug con -dN y ahora es unico, forzar reprocesamiento
      if (entry.slug && entry.slug !== slugBase) {
        changedPaths.add(path);
        if (!recentFiles.includes(path)) recentFiles.push(path);
        slugChangedEntries.set(path, entry.slug);
      }
      entry.slug = slugBase;
    } else {
      // Duplicates: preservar -dN existentes, asignar maxN+1 a nuevos
      paths.sort();

      // Fase 1: preservar -dN de archivos existentes, calcular max N actual
      let maxN = slugsCounter.get(key) ?? 0;
      const existingSlugs = new Map<string, string>();
      for (const path of paths) {
        const entry = discoveryIndex.get(path)!;
        const slugBase = computeSlug({ title: entry.title, author: entry.author }) ?? basename(path, '.md');
        if (entry.slug) {
          const m = entry.slug.match(/-d(\d+)$/);
          if (m) {
            const prefix = entry.slug.slice(0, -m[0].length);
            if (prefix === slugBase) {
              const n = parseInt(m[1]!, 10);
              if (n > maxN) maxN = n;
              existingSlugs.set(path, entry.slug);
            }
          }
        }
      }

      // Fase 2: asignar slugs para archivos sin -dN (nuevos o que cambiaron de slug base)
      let nextN = maxN + 1;
      for (const path of paths) {
        if (existingSlugs.has(path)) continue;
        const entry = discoveryIndex.get(path)!;
        const slugBase = computeSlug({ title: entry.title, author: entry.author }) ?? basename(path, '.md');
        const newSlug = slugBase + '-d' + nextN;
        // Si el slug existente cambio, forzar reprocesamiento y limpiar archivos viejos
        if (entry.slug && entry.slug !== newSlug) {
          changedPaths.add(path);
          if (!recentFiles.includes(path)) recentFiles.push(path);
          slugChangedEntries.set(path, entry.slug);
        }
        entry.slug = newSlug;
        nextN++;
      }

      // Actualizar contador con el maximo asignado
      slugsCounter.set(key, nextN - 1);
    }
  }

  // Guardar contador de slugs solo si hay grupos duplicados
  if (hasDuplicateGroups) {
    await saveSlugsCounter(cwd, slugsCounter);
  }

  await saveBuildState(cwd, {
    startedAt: thisBuildStartedAt,
    activeFormats: options.activeFormats ?? [],
    entries: discoveryIndex,
  });

  return { relativePaths, changedPaths, discoveryIndex, deletedEntries, slugChangedEntries };
}

/** Directorios que el CLI ignora al escanear el proyecto. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);

/**
 * Construye BuildDocument[] con frontmatter desde discoveryIndex.
 * Solo title y author — el resto usa valores por defecto.
 */
export function buildDocsFromIndex(relativePaths: string[], discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): BuildDocument[] {
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
    };
  });
}
