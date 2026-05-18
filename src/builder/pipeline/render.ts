import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import { convertFragment } from '../../services/pandoc-runner.js';
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
): Promise<BuildDocument[]> {
  return mapWithConcurrency(docs, concurrency, async (doc) => {
    if (cache) {
      const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion, cache.pluginFingerprint ?? '');
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

    let htmlFragment = await convertFragment(doc.body, doc.filePath);

    if (registry) {
      const afterCtx = await registry.runAfterRender({ sourcePath: doc.filePath, html: htmlFragment });
      htmlFragment = afterCtx.html;
    }

    if (cache) {
      const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion, cache.pluginFingerprint ?? '');
      await cache.manager.write('render', key, htmlFragment);
    }
    if (stats) stats.total++;
    return { ...doc, htmlFragment };
  });
}
