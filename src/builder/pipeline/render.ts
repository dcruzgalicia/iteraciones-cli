import { resolve } from 'node:path';
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
  /** Conjunto mutable donde se acumulan las claves de caché usadas; permite al caller usarlas para prune. */
  collectedKeys?: Set<string>,
): Promise<BuildDocument[]> {
  // Memoiza hashes de archivos para no leerlos más de una vez por llamada.
  // Válido para la duración de esta llamada a renderDocuments(); si se invoca
  // múltiples veces en el mismo build, el mapa se reinicia en cada llamada.
  const bibHashCache = new Map<string, string>();

  const getBibHash = async (bibPath: string): Promise<string> => {
    const cached = bibHashCache.get(bibPath);
    if (cached !== undefined) return cached;
    const bibFile = Bun.file(bibPath);
    if (!(await bibFile.exists())) {
      bibHashCache.set(bibPath, '');
      return '';
    }
    try {
      const hasher = new Bun.CryptoHasher('sha256');
      hasher.update(await bibFile.text());
      const h = hasher.digest('hex');
      bibHashCache.set(bibPath, h);
      return h;
    } catch (err) {
      process.stderr.write(`[render] no se pudo leer "${bibPath}" para caché: ${err instanceof Error ? err.message : String(err)}\n`);
      bibHashCache.set(bibPath, '');
      return '';
    }
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
        // resolve() normaliza siempre: elimina '..', maneja rutas absolutas y relativas.
        // Una ruta '/project/../etc/passwd' queda '/etc/passwd', que luego falla startsWith.
        const resolvedBib = resolve(cwd, rawBib);
        // Validar que la ruta esté dentro del proyecto.
        if (resolvedBib.startsWith(cwd + '/') || resolvedBib === cwd) {
          const rawCsl = typeof rawEditorial['csl'] === 'string' ? rawEditorial['csl'] : undefined;
          let resolvedCsl: string | undefined;
          if (rawCsl) {
            const cslAbs = resolve(cwd, rawCsl);
            if (cslAbs.startsWith(cwd + '/') || cslAbs === cwd) {
              resolvedCsl = cslAbs;
            } else {
              process.stderr.write(`[render] editorial.csl fuera del proyecto ignorado: "${rawCsl}"\n`);
            }
          }
          bibOptions = { bibliography: resolvedBib, csl: resolvedCsl };
        } else {
          process.stderr.write(`[render] editorial.bibliography fuera del proyecto ignorado: "${rawBib}"\n`);
        }
      }
    }

    if (cache) {
      const bibHash = bibOptions ? await getBibHash(bibOptions.bibliography) : '';
      const cslHash = bibOptions?.csl ? await getBibHash(bibOptions.csl) : '';
      const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion, cache.pluginFingerprint ?? '', bibHash, cslHash);
      collectedKeys?.add(key);
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
      const cslHash = bibOptions?.csl ? await getBibHash(bibOptions.csl) : '';
      const key = hash(doc.sourceHash, cache.cliVersion, cache.pandocVersion, cache.pluginFingerprint ?? '', bibHash, cslHash);
      collectedKeys?.add(key);
      await cache.manager.write('render', key, htmlFragment);
    }
    if (stats) stats.total++;
    return { ...doc, htmlFragment };
  });
}
