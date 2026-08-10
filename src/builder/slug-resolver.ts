import { dirname } from 'node:path';
import { BuildError } from '../lib/errors.js';
import type { DiscoveryEntry } from './types.js';

interface SlugResolutionResult {
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
/**
 * Entrada del discovery index para un path. El path siempre existe: los
 * grupos se construyen iterando el index y los callers solo pasan paths del
 * mismo index (el guard es defensivo ante bugs de refactor).
 */
function entryFor(discoveryIndex: Map<string, DiscoveryEntry>, path: string): DiscoveryEntry {
  const entry = discoveryIndex.get(path);
  if (entry === undefined) throw new Error(`sin entrada de discovery para ${path}`);
  return entry;
}

/**
 * Intenta resolver colisiones de slugs expandiendo el número de autores.
 * Para cada documento en colisión, prueba con 2, 3... autores hasta
 * encontrar un slug único dentro del grupo. Los que no pueden expandirse
 * más (sin autores adicionales) conservan el slug base para -dN.
 */
function resolveByAuthorExpansion(
  paths: string[],
  discoveryIndex: Map<string, DiscoveryEntry>,
  computeSlugFn: (meta: { title: string; author: string[] }, opts: { fallbackPath: string; maxAuthors?: number }) => string,
): Array<[string, string]> {
  const result: Array<[string, string]> = paths.map((path) => {
    const entry = entryFor(discoveryIndex, path);
    return [path, computeSlugFn({ title: entry.title, author: entry.author }, { fallbackPath: path })];
  });
  // Para cada slug que aparece más de una vez, intentar expandir autores
  const slugCount = new Map<string, number>();
  for (const [_, slug] of result) slugCount.set(slug, (slugCount.get(slug) ?? 0) + 1);
  // Set de slugs en uso: la verificación de colisión es O(1) por entrada
  // (en lugar de un filter sobre todo el resultado en cada intento).
  const usedSlugs = new Set(result.map(([_, slug]) => slug));
  for (let tryAuthors = 2; tryAuthors <= 20; tryAuthors++) {
    let changed = false;
    for (const entry of result) {
      const [path, slug] = entry;
      if ((slugCount.get(slug) ?? 0) <= 1) continue;
      const meta = entryFor(discoveryIndex, path);
      const expanded = computeSlugFn({ title: meta.title, author: meta.author }, { fallbackPath: path, maxAuthors: tryAuthors });
      if (expanded !== slug && !usedSlugs.has(expanded)) {
        const remaining = (slugCount.get(slug) ?? 1) - 1;
        slugCount.set(slug, remaining);
        if (remaining === 0) usedSlugs.delete(slug);
        slugCount.set(expanded, (slugCount.get(expanded) ?? 0) + 1);
        usedSlugs.add(expanded);
        entry[1] = expanded;
        changed = true;
      }
    }
    if (!changed) break; // sin más resoluciones posibles
  }
  return result;
}

export async function resolveSlugs(
  discoveryIndex: Map<string, DiscoveryEntry>,
  computeSlug: (meta: { title: string; author: string[] }, opts: { fallbackPath: string; maxAuthors?: number }) => string,
): Promise<SlugResolutionResult> {
  const slugChangedEntries = new Map<string, string>();
  const changedPaths: string[] = [];
  const newRecentFiles: string[] = [];

  // Slugs manuales (frontmatter slug:): se respetan tal cual y no participan
  // en la resolución automática. El cambio contra el slug previo (de state.json)
  // se reporta para limpiar los outputs del slug anterior.
  for (const [relPath, entry] of discoveryIndex) {
    if (!entry.slugFixed) continue;
    const newSlug = entry.manualSlug;
    if (newSlug === undefined) continue; // defensivo: slugFixed implica manualSlug
    const prevSlug = entry.slug;
    if (prevSlug && prevSlug !== newSlug) {
      changedPaths.push(relPath);
      newRecentFiles.push(relPath);
      slugChangedEntries.set(relPath, prevSlug);
    }
    entry.slug = newSlug;
  }

  // Agrupar por slug base (solo entradas sin slug manual)
  const slugGroups = new Map<string, string[]>();
  for (const [relPath, entry] of discoveryIndex) {
    if (entry.slugFixed) continue;
    const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: relPath });
    const dir = dirname(relPath);
    const key = dir === '.' ? slugBase : `${dir}/${slugBase}`;
    if (!slugGroups.has(key)) slugGroups.set(key, []);
    slugGroups.get(key)?.push(relPath);
  }

  // Los grupos con colisión se resuelven con expansión de autores o sufijos
  // -dN derivados del discovery index (sin estado persistente adicional).
  for (const [_, paths] of slugGroups) {
    if (paths.length <= 1) {
      const path = paths[0];
      if (path === undefined) throw new Error('slug-resolver: grupo de slugs vacío');
      const entry = entryFor(discoveryIndex, path);
      const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: path });
      // Un doc que queda único conserva su sufijo -dN: la renumeración a slug
      // limpio solo corresponde a builds sin estado previo (--full).
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
      // Intentar resolver la colisión expandiendo autores antes de usar -dN
      const expanded = resolveByAuthorExpansion(paths, discoveryIndex, computeSlug);
      // Los que quedaron sin resolver (mismo slug) usan -dN
      const stillColliding = new Map<string, string[]>();
      for (const [path, slug] of expanded) {
        if (!stillColliding.has(slug)) stillColliding.set(slug, []);
        stillColliding.get(slug)?.push(path);
      }
      let maxN = 0;
      const existingSlugs = new Map<string, string>();
      for (const path of paths) {
        const entry = entryFor(discoveryIndex, path);
        if (entry.slug) {
          const m = entry.slug.match(/-d(\d+)$/);
          if (m) {
            const n = parseInt(m[1] ?? '0', 10);
            if (n > maxN) maxN = n;
            existingSlugs.set(path, entry.slug);
          }
        }
      }
      let nextN = maxN + 1;
      for (const [slug, slugPaths] of stillColliding) {
        for (const path of slugPaths) {
          // Solo aplicar -dN si este path participa en la colisión real
          const allForSlug = stillColliding.get(slug) ?? [];
          if (allForSlug.length <= 1) {
            // La expansión de autores lo resolvió
            const entry = entryFor(discoveryIndex, path);
            const currentSlug = expanded.find(([p]) => p === path)?.[1] ?? slug;
            if (entry.slug && entry.slug !== currentSlug) {
              changedPaths.push(path);
              newRecentFiles.push(path);
              slugChangedEntries.set(path, entry.slug);
            }
            entry.slug = currentSlug;
            continue;
          }
          // Persiste la colisión: aplicar -dN
          const entry = entryFor(discoveryIndex, path);
          const newSlug = existingSlugs.get(path) ?? `${slug}-d${nextN}`;
          if (!existingSlugs.has(path)) nextN++;
          if (entry.slug && entry.slug !== newSlug) {
            changedPaths.push(path);
            newRecentFiles.push(path);
            slugChangedEntries.set(path, entry.slug);
          }
          entry.slug = newSlug;
        }
      }
    }
  }

  // Colisión con slugs manuales (o entre manuales): dos entradas con la misma
  // salida (directorio + slug) sobrescribirían sus archivos en dist/. Los slugs
  // automáticos ya se resuelven sin duplicados por grupo; este check solo puede
  // dispararse por un slug manual que coincida con otra salida.
  const slugOwners = new Map<string, string>();
  const collisions: string[] = [];
  for (const [relPath, entry] of discoveryIndex) {
    const s = entry.slug;
    if (!s) continue;
    const outputKey = `${dirname(relPath)}/${s}`;
    const owner = slugOwners.get(outputKey);
    if (owner !== undefined) {
      collisions.push(`${owner} y ${relPath} → "${s}"`);
    } else {
      slugOwners.set(outputKey, relPath);
    }
  }
  if (collisions.length > 0) {
    throw new BuildError(`slugs duplicados: ${collisions.join('; ')}`);
  }

  return { slugChangedEntries, changedPaths, newRecentFiles };
}
