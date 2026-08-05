import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logWarning } from '../lib/logger.js';
import type { DiscoveryEntry } from './types.js';

const SLUGS_CACHE_PATH = join('.iteraciones', 'changes', 'slugs.json');

async function loadSlugsCounter(cwd: string): Promise<Map<string, number>> {
  const file = Bun.file(join(cwd, SLUGS_CACHE_PATH));
  if (!(await file.exists())) return new Map();
  try {
    const raw = await file.text();
    const parsed: Record<string, number> = JSON.parse(raw);
    return new Map(Object.entries(parsed));
  } catch (err) {
    logWarning(`no se pudo leer slugs.json; se reinicia el contador de slugs duplicados: ${String(err)}`, 'discover');
    return new Map();
  }
}

async function saveSlugsCounter(cwd: string, counter: Map<string, number>): Promise<void> {
  const filePath = join(cwd, SLUGS_CACHE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(Object.fromEntries(counter)));
}

export interface SlugResolutionResult {
  /** Archivos cuyo slug cambio (relativePath -> slug anterior). */
  slugChangedEntries: Map<string, string>;
  /** Paths que deben reprocesarse por cambio de slug. */
  changedPaths: string[];
  /** Paths que deben agregarse a recentFiles. */
  newRecentFiles: string[];
}

/**
 * Resuelve slugs para todas las entradas del discovery index.
 * Asigna sufijos -dN para duplicados, preserva slugs existentes,
 * y detecta cambios de slug que requieren reprocesamiento.
 */
export async function resolveSlugs(
  cwd: string,
  discoveryIndex: Map<string, DiscoveryEntry>,
  computeSlug: (meta: { title: string; author: string[] }, opts: { fallbackPath: string }) => string,
): Promise<SlugResolutionResult> {
  const slugChangedEntries = new Map<string, string>();
  const changedPaths: string[] = [];
  const newRecentFiles: string[] = [];

  // Agrupar por slug base
  const slugGroups = new Map<string, string[]>();
  for (const [relPath, entry] of discoveryIndex) {
    const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: relPath });
    const dir = dirname(relPath);
    const key = dir === '.' ? slugBase : dir + '/' + slugBase;
    if (!slugGroups.has(key)) slugGroups.set(key, []);
    slugGroups.get(key)!.push(relPath);
  }

  const hasDuplicateGroups = [...slugGroups.values()].some((paths) => paths.length > 1);
  const slugsCounter = hasDuplicateGroups ? await loadSlugsCounter(cwd) : new Map<string, number>();

  for (const [key, paths] of slugGroups) {
    if (paths.length <= 1) {
      const path = paths[0]!;
      const entry = discoveryIndex.get(path)!;
      const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: path });
      // Un doc que queda único conserva su sufijo -dN: la renumeración a slug
      // limpio solo corresponde a builds sin estado previo (--no-cache).
      const prevSlug = entry.slug;
      const dnMatch = prevSlug?.match(/^(.*)-d(\d+)$/);
      if (!(dnMatch && dnMatch[1] === slugBase)) {
        if (prevSlug && prevSlug !== slugBase) {
          changedPaths.push(path);
          newRecentFiles.push(path);
          slugChangedEntries.set(path, prevSlug);
        }
        entry.slug = slugBase;
      }
    } else {
      paths.sort();
      let maxN = slugsCounter.get(key) ?? 0;
      const existingSlugs = new Map<string, string>();
      for (const path of paths) {
        const entry = discoveryIndex.get(path)!;
        const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: path });
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

      let nextN = maxN + 1;
      for (const path of paths) {
        if (existingSlugs.has(path)) continue;
        const entry = discoveryIndex.get(path)!;
        const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: path });
        const newSlug = slugBase + '-d' + nextN;
        if (entry.slug && entry.slug !== newSlug) {
          changedPaths.push(path);
          newRecentFiles.push(path);
          slugChangedEntries.set(path, entry.slug);
        }
        entry.slug = newSlug;
        nextN++;
      }
      slugsCounter.set(key, nextN - 1);
    }
  }

  if (hasDuplicateGroups) {
    await saveSlugsCounter(cwd, slugsCounter);
  }

  return { slugChangedEntries, changedPaths, newRecentFiles };
}
