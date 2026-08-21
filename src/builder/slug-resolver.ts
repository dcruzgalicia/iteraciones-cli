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
 * Resuelve slugs para todas las entradas del discovery index.
 * Asigna sufijos -dN para duplicados, preserva slugs existentes,
 * y detecta cambios de slug que requieren reprocesamiento.
 */
export async function resolveSlugs(
  discoveryIndex: Map<string, DiscoveryEntry>,
  computeSlug: (meta: { title: string; creator: string[] }, opts: { fallbackPath: string; maxCreators?: number }) => string,
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
    const slugBase = computeSlug({ title: entry.title, creator: entry.creator }, { fallbackPath: relPath });
    const dir = dirname(relPath);
    const key = dir === '.' ? slugBase : `${dir}/${slugBase}`;
    if (!slugGroups.has(key)) slugGroups.set(key, []);
    slugGroups.get(key)?.push(relPath);
  }

  // Los grupos con colisión se resuelven con sufijos -dN derivados del
  // discovery index (sin estado persistente adicional).
  for (const [key, paths] of slugGroups) {
    // El slug base del grupo es la parte final de la clave (dir/slugBase).
    const slugBase = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
    if (paths.length <= 1) {
      const path = paths[0];
      if (path === undefined) throw new Error('slug-resolver: grupo de slugs vacío');
      const entry = entryFor(discoveryIndex, path);
      const slugBase = computeSlug({ title: entry.title, creator: entry.creator }, { fallbackPath: path });
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
      // Colisión: sufijos -dN secuenciales derivados del discovery index (sin
      // estado persistente adicional). La renumeración solo ocurre en builds
      // sin estado previo (--full): los -dN existentes se conservan.
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
      for (const path of paths) {
        const entry = entryFor(discoveryIndex, path);
        const newSlug = existingSlugs.get(path) ?? `${slugBase}-d${nextN}`;
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
