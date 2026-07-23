import { join } from 'node:path';
import { loadDiscoveryIndex, saveDiscoveryIndex } from '../../cache/discovery-index.js';
import { IGNORED_DIRS } from '../../constants.js';
import { parseFrontmatter } from '../../loader/frontmatter.js';
import type { SourceDocument } from '../types.js';

export interface DiscoverOptions {
  /** Si es true, ignora el índice de discovery en disco (siempre lee todos los archivos). */
  noCache?: boolean;
}

export async function discover(cwd: string, options: DiscoverOptions = {}): Promise<{ docs: SourceDocument[]; changedPaths: Set<string> }> {
  const relativePaths: string[] = [];

  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    relativePaths.push(entry);
  }

  relativePaths.sort();

  const useCache = !options.noCache;
  const cachedIndex = useCache ? await loadDiscoveryIndex(cwd) : new Map();
  const updatedIndex = new Map(cachedIndex);
  const changedPaths = new Set<string>();

  const docs = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const filePath = join(cwd, relativePath);
      const file = Bun.file(filePath);

      let mtimeMs: number;
      try {
        const stat = await file.stat();
        mtimeMs = stat.mtime.getTime();
      } catch (err) {
        throw new Error(`Error al leer "${relativePath}": ${String(err)}`, { cause: err });
      }

      const cached = cachedIndex.get(relativePath);
      if (useCache && cached !== undefined && cached.mtimeMs === mtimeMs) {
        // Caché válida: reusar datos sin leer el archivo.
        return { filePath, relativePath, frontmatter: cached.frontmatter, body: cached.body, sourceHash: cached.sourceHash, mtimeMs };
      }

      // Caché inválida o ausente: el archivo cambio o es nuevo → registrar en changedPaths
      changedPaths.add(relativePath);

      // Caché inválida o ausente: leer y procesar el archivo.
      let raw: string;
      try {
        raw = await file.text();
      } catch (err) {
        throw new Error(`Error al leer "${relativePath}": ${String(err)}`, { cause: err });
      }

      const { frontmatter, body } = parseFrontmatter(raw);

      const hasher = new Bun.CryptoHasher('sha256');
      hasher.update(raw);
      const sourceHash = hasher.digest('hex');

      updatedIndex.set(relativePath, { mtimeMs, sourceHash, frontmatter, body });

      return { filePath, relativePath, frontmatter, body, sourceHash, mtimeMs };
    }),
  );

  if (useCache) {
    // Eliminar entradas del índice que ya no tienen archivo correspondiente.
    const relativePathsSet = new Set(relativePaths);
    for (const key of updatedIndex.keys()) {
      if (!relativePathsSet.has(key)) {
        updatedIndex.delete(key);
        changedPaths.add(key);
      }
    }
    await saveDiscoveryIndex(cwd, updatedIndex);
  }

  return { docs, changedPaths };
}
