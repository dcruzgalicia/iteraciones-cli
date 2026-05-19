import { isAbsolute, resolve } from 'node:path';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import type { PandocPool } from '../../services/pandoc-pool.js';
import { type BibOptions, convertFragment } from '../../services/pandoc-runner.js';
import type { BuildDocument } from '../types.js';

export interface RenderCache {
  manager: CacheManager;
  cliVersion: string;
  pandocVersion: string;
  /** Hash de los paths de plugins activos. Invalida la caché si cambia el conjunto de plugins. */
  pluginFingerprint?: string;
}

/** Contadores acumulativos de la fase de render; se mutan en lugar de retornar un nuevo objeto. */
export interface RenderStats {
  total: number;
  cacheHits: number;
}

export async function renderDocuments(
  docs: BuildDocument[],
  concurrency: number,
  cache?: RenderCache,
  registry?: PluginRegistry,
  stats?: RenderStats,
  pool?: PandocPool,
  cwd?: string,
): Promise<BuildDocument[]> {
  // Memoiza hashes de archivos .bib para no leerlos más de una vez por build.
  const bibHashCache = new Map<string, string>();

  const getBibHash = async (bibPath: string): Promise<string> => {
    const cached = bibHashCache.get(bibPath);
    if (cached !== undefined) return cached;
    const bibFile = Bun.file(bibPath);
    if (!(await bibFile.exists())) return '';
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(await bibFile.text());
    const h = hasher.digest('hex');
    bibHashCache.set(bibPath, h);
    return h;
  };

  return mapWithConcurrency(docs, concurrency, async (doc) => {
    // Detectar bibliography en editorial del frontmatter.
    // Solo se activa si hay cwd disponible para resolver la ruta.
    let bibOptions: BibOptions | undefined;
    if (cwd) {
      const rawEditorial =
        typeof doc.frontmatter['editorial'] === 'object' && doc.frontmatter['editorial'] !== null
          ? (doc.frontmatter['editorial'] as Record<string, unknown>)
          : {};
      const rawBib = typeof rawEditorial['bibliography'] === 'string' ? rawEditorial['bibliography'] : undefined;
      if (rawBib) {
        const resolvedBib = isAbsolute(rawBib) ? rawBib : resolve(cwd, rawBib);
        // Validar que la ruta esté dentro del proyecto.
        if (resolvedBib.startsWith(cwd + '/') || resolvedBib === cwd) {
          const rawCsl = typeof rawEditorial['csl'] === 'string' ? rawEditorial['csl'] : undefined;
          let resolvedCsl: string | undefined;
          if (rawCsl) {
            const cslAbs = isAbsolute(rawCsl) ? rawCsl : resolve(cwd, rawCsl);
            if (cslAbs.startsWith(cwd + '/') || cslAbs === cwd) resolvedCsl = cslAbs;
          }
          bibOptions = { bibliography: resolvedBib, csl: resolvedCsl };
        } else {
          process.stderr.write(`[render] editorial.bibliography fuera del proyecto ignorado: "${rawBib}"\n`);
        }
      }
    }

    if (cache) {
      const bibHash = bibOptions ? await getBibHash(bibOptions.bibliography) : '';
      const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion, cache.pluginFingerprint ?? '', bibHash);
      const cached = await cache.manager.read('render', key);
      if (cached !== undefined) {
        if (stats) {
          stats.total++;
          stats.cacheHits++;
        }
        return { ...doc, htmlFragment: cached };
      }
    }

    // beforeRender: las variables retornadas no se pasan a pandoc en la implementación
    // actual (convertFragment no acepta variables); el hook sirve como punto de
    // observación del ciclo de renderizado.
    if (registry) {
      await registry.runBeforeRender({ sourcePath: doc.filePath, variables: {} });
    }

    let htmlFragment = await convertFragment(doc.body, doc.filePath, pool, bibOptions);

    if (registry) {
      const afterCtx = await registry.runAfterRender({ sourcePath: doc.filePath, html: htmlFragment });
      htmlFragment = afterCtx.html;
    }

    if (cache) {
      const bibHash = bibOptions ? await getBibHash(bibOptions.bibliography) : '';
      const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion, cache.pluginFingerprint ?? '', bibHash);
      await cache.manager.write('render', key, htmlFragment);
    }
    if (stats) stats.total++;
    return { ...doc, htmlFragment };
  });
}
