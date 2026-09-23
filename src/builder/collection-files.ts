import { exists } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export type CollectionFileResolution = { ok: true; rootRelative: string } | { ok: false; tried: string[] };

/**
 * #2443: resuelve una entrada de `files[]` de una collection. Primero se
 * intenta relativa al directorio de la collection (admite `../` y cualquier
 * anidamiento); si no existe ahí, relativa a la raíz del proyecto
 * (compatibilidad con la convención previa). Devuelve la ruta normalizada
 * relativa a la raíz: esa es la forma en que aguas abajo se consumen los
 * files (exclusión de miembros, creators, copias en dist y el `files[]`
 * reescrito del markdown exportado).
 */
export async function resolveCollectionFile(file: string, collectionRelPath: string, cwd: string): Promise<CollectionFileResolution> {
  const fromCollection = join(cwd, dirname(collectionRelPath), file);
  const fromRoot = join(cwd, file);
  const candidates = fromCollection === fromRoot ? [fromCollection] : [fromCollection, fromRoot];
  for (const candidate of candidates) {
    if (await exists(candidate)) return { ok: true, rootRelative: relative(cwd, candidate) };
  }
  return { ok: false, tried: candidates };
}
