import { join, resolve } from 'node:path';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { RenderFileReport } from '../../output/progress.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import type { PandocPool } from '../../services/pandoc-pool.js';
import { type BibOptions, convertFragment } from '../../services/pandoc-runner.js';
import type { BuildDocument } from '../types.js';

/**
 * Carga y aplica transpilers desde el directorio <paquete>/transpilers/.
 * Cada transpiler exporta una función process(body: string): string.
 *
 * Los transpilers se aplican en orden alfabético antes de pasar el
 * contenido a pandoc.
 */
interface Transpiler {
  process(body: string): string;
}

/** Ruta absoluta al directorio de transpilers del paquete. */
const PKG_TRANSPILERS_DIR = join(import.meta.dir, '../../../transpilers');

/** Lista de transpilers empaquetados (orden de aplicación). */
const BUILTIN_TRANSPILERS = ['double-colon'];

async function applyTranspilers(body: string, cwd?: string): Promise<string> {
  let result = body;

  // Transpilers del paquete: se cargan con import() dinámico
  for (const name of BUILTIN_TRANSPILERS) {
    const mod = (await import(join(PKG_TRANSPILERS_DIR, `${name}.ts`))) as Transpiler;
    result = mod.process(result);
  }

  // Proyecto: si existe <cwd>/transpilers/, cargar transpilers del proyecto
  // (sobrescriben o complementan a los del paquete por el mismo nombre)
  if (cwd) {
    const projectDir = join(cwd, 'transpilers');
    const projectDirExists = await Bun.file(projectDir)
      .exists()
      .catch(() => false);
    if (projectDirExists) {
      for (const name of BUILTIN_TRANSPILERS) {
        const projectPath = join(projectDir, `${name}.ts`);
        const exists = await Bun.file(projectPath)
          .exists()
          .catch(() => false);
        if (exists) {
          const mod = (await import(projectPath)) as Transpiler;
          result = mod.process(result);
        }
      }
    }
  }

  return result;
}

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

/**
 * Aplica un filtro TypeScript (pandoc JSON pipe) al contenido JSON AST.
 * El filtro debe leer JSON de stdin y escribir JSON modificado a stdout.
 */
async function pipeThroughTsFilter(filterPath: string, input: string): Promise<string> {
  if (!input.trim()) return input;

  const proc = Bun.spawn(['bun', 'run', filterPath], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (!proc.stdin || typeof proc.stdin === 'number') return input;
  proc.stdin.write(input);
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    process.stderr.write(`[pipe] filtro TypeScript ${filterPath} falló (exit ${exitCode}): ${stderr}
`);
    return input;
  }

  return stdout;
}

/**
 * Convierte el body original de cada documento a LaTeX final (processedBody)
 * aplicando transpilers, filtros TypeScript (JSON pipe) y filtros Lua.
 *
 * Pipeline:
 *   markdown → transpilers → pandoc --to json → dictum.ts → pandoc --from json --to latex → .tex
 *
 * El processedBody (.tex) se usa luego como fuente para HTML, PDF, EPUB y markdown.
 */
export async function renderLatex(
  docs: BuildDocument[],
  concurrency: number,
  pool?: PandocPool,
  luaFilters?: readonly string[],
  cwd?: string,
): Promise<BuildDocument[]> {
  // Ruta al filtro TypeScript dictum (built-in del paquete)
  const dictumFilter = join(import.meta.dir, '../../../pandoc/filters/dictum.ts');

  return mapWithConcurrency(docs, concurrency, async (doc) => {
    const body = await applyTranspilers(doc.body, cwd);

    if (!body.trim()) {
      return { ...doc, processedBody: '' };
    }

    // Paso 1: convertir markdown a JSON AST
    const json = await convertFragment(body, doc.filePath, pool, undefined, undefined, 'json');

    // Paso 2: aplicar filtro TypeScript dictum sobre el AST
    const filteredJson = await pipeThroughTsFilter(dictumFilter, json);

    // Paso 3: convertir el AST modificado a LaTeX
    const processedBody = await convertFragment(filteredJson, doc.filePath, pool, undefined, luaFilters, 'latex', 'json');

    return { ...doc, processedBody };
  });
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
  /** Rutas absolutas a filtros Pandoc Lua que se aplican durante la conversión. */
  luaFilters?: readonly string[],
  /** Ruta absoluta al .bib global del sitio (fallback si el frontmatter no define editorial.bibliography). */
  globalBibliography?: string,
  /** Ruta absoluta al .csl global del sitio (fallback si el frontmatter no define editorial.csl). */
  globalCsl?: string,
  /** Callback invocado por cada archivo procesado (para reporte de progreso). */
  onFileProcessed?: (report: RenderFileReport) => void,
): Promise<BuildDocument[]> {
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
    const tStart = performance.now();
    let bibOptions: BibOptions | undefined;
    if (cwd) {
      const rawEditorial =
        typeof doc.frontmatter['editorial'] === 'object' && doc.frontmatter['editorial'] !== null
          ? (doc.frontmatter['editorial'] as Record<string, unknown>)
          : {};

      const rawBib = typeof rawEditorial['bibliography'] === 'string' ? rawEditorial['bibliography'] : undefined;
      const effectiveBib = rawBib ?? globalBibliography;

      if (effectiveBib) {
        const resolvedBib = resolve(cwd, effectiveBib);
        if (resolvedBib.startsWith(cwd + '/') || resolvedBib === cwd) {
          const rawCsl = typeof rawEditorial['csl'] === 'string' ? rawEditorial['csl'] : undefined;
          const effectiveCsl = rawCsl ?? globalCsl;
          let resolvedCsl: string | undefined;
          if (effectiveCsl) {
            const cslAbs = resolve(cwd, effectiveCsl);
            if (cslAbs.startsWith(cwd + '/') || cslAbs === cwd) {
              resolvedCsl = cslAbs;
            } else {
              process.stderr.write(`[render] CSL fuera del proyecto ignorado: "${effectiveCsl}"\n`);
            }
          } else {
            resolvedCsl = join(import.meta.dir, '../../../pandoc/csl/apa-7.csl');
          }
          bibOptions = { bibliography: resolvedBib, csl: resolvedCsl };
        } else {
          process.stderr.write(`[render] bibliography fuera del proyecto ignorado: "${effectiveBib}"\n`);
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
        onFileProcessed?.({ relativePath: doc.relativePath, durationMs: performance.now() - tStart, cacheHit: true, phase: 'render' });
        return { ...doc, htmlFragment: cached };
      }
    }

    if (registry) {
      await registry.runBeforeRender({ sourcePath: doc.filePath, variables: {} });
    }

    const source = doc.processedBody ?? doc.body;
    const fromFormat = doc.processedBody ? 'latex' : 'markdown';
    let htmlFragment = await convertFragment(source, doc.filePath, pool, bibOptions, undefined, 'html5', fromFormat);

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
    onFileProcessed?.({ relativePath: doc.relativePath, durationMs: performance.now() - tStart, cacheHit: false, phase: 'render' });
    return { ...doc, htmlFragment };
  });
}
