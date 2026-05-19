import { rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { CacheManager } from '../cache/cache-manager.js';
import { hash } from '../cache/hasher.js';
import { loadOutputManifest, saveOutputManifest } from '../cache/output-manifest.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { clean, writeFile } from '../output/writer.js';
import { loadPlugins } from '../plugin/loader.js';
import { PluginRegistry } from '../plugin/registry.js';
import type { GeneratedFile, PluginDocumentSummary } from '../plugin/types.js';
import { PandocPool } from '../services/pandoc-pool.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import type { TemplateContext } from '../template/render/context.js';
import { buildAssets } from './assets.js';
import { createAuthorDocumentIndex } from './context/authors.js';
import { buildSiteContext } from './context/site.js';
import { type ExportStats, injectDownloadLinks, runExportDocuments } from './export/runner.js';
import { escapeHtml } from './html.js';
import { classifyDocuments } from './pipeline/classify.js';
import { type ComposeCache, type ComposeStats, composeDocuments, renderBlocksToRegions } from './pipeline/compose.js';
import { computeAffectedDocs } from './pipeline/dependency-resolver.js';
import { discover } from './pipeline/discover.js';
import { type RenderCache, type RenderStats, renderDocuments } from './pipeline/render.js';
import { runContextPhaseWithTypeGraph } from './pipeline/runner.js';
import { TYPE_STAGE_MAP } from './pipeline/type-graph.js';
import { writeDocuments } from './pipeline/write.js';
import type { AuthorDocumentIndex, BuildContext, BuildDocument, DocumentType } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  cssPath?: string;
  concurrency?: number;
  /** Omite lectura y escritura de la caché; siempre hace build completo. */
  noCache?: boolean;
  /** Omite la generación de CSS con Tailwind; copia fonts y logo igualmente. */
  noTailwind?: boolean;
  /** Omite la exportación PDF/EPUB aunque esté configurada en _iteraciones.yaml. */
  noExport?: boolean;
  /** Muestra los documentos que se procesarían sin generar salida. */
  dryRun?: boolean;
  /** Imprime información adicional de progreso durante el build. */
  verbose?: boolean;
  /** Omite clean() del outputDir; solo escribe archivos nuevos o modificados. */
  incremental?: boolean;
  /** Rutas relativas de archivos modificados; limita el pipeline a docs afectados. */
  changedPaths?: Set<string>;
}

// ---------------------------------------------------------------------------
// Interfaces internas de resultado entre funciones del pipeline
// ---------------------------------------------------------------------------

interface SetupResult {
  ctx: BuildContext;
  cacheManager: CacheManager;
  renderCache: RenderCache | undefined;
  composeCache: ComposeCache | undefined;
  registry: PluginRegistry;
  hasPlugins: boolean;
  pandocPool: PandocPool | undefined;
  /** Versión del CLI (de package.json), para claves de caché de exportación. */
  cliVersion: string;
  /** Versión de pandoc detectada en el entorno, para claves de caché. */
  pandocVersion: string;
  /** Hash del contenido de los plugins activos para invalidar cachés cuando cambian. */
  pluginFingerprint: string | undefined;
}

interface PrimaryRenderResult {
  renderedFileDocs: BuildDocument[];
  renderedAuthorDocs: BuildDocument[];
  renderedEventDocs: BuildDocument[];
  authorDocumentIndex: AuthorDocumentIndex;
}

interface BlocksPrestepResult {
  finalSiteCtx: TemplateContext;
  renderedBlockDocs: BuildDocument[];
}

// ---------------------------------------------------------------------------
// Helpers puros (sin efectos secundarios)
// ---------------------------------------------------------------------------

/** Excluye del pool todos los documentos marcados con `draft: true`. */
function excludeDrafts(docs: BuildDocument[]): BuildDocument[] {
  return docs.filter((doc) => !doc.frontmatter.draft);
}

/**
 * Calcula el prefijo relativo para navegar desde `relativePath` hasta la raíz del sitio.
 * Ejemplos: 'index.md' -> './',  'personas/sofia.md' -> '../',  'a/b/c.md' -> '../../'
 */
function computeRootPrefix(relativePath: string): string {
  const depth = relativePath.split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/**
 * Recorre recursivamente un TemplateContext y convierte toda cadena que empiece con '/'
 * en una ruta relativa usando `prefix`. Permite que el sitio funcione con file://.
 * Los strings HTML (region slots de bloques) se procesan con regex para relativizar
 * atributos href y src que contengan rutas root-relative embebidas en el marcado.
 *
 * `depth` protege contra objetos circulares emitidos por plugins mal escritos.
 */
function makeRelativeContext(value: unknown, prefix: string, depth = 0): unknown {
  if (depth > 20) throw new Error('makeRelativeContext: profundidad máxima excedida (posible objeto circular en el contexto de un plugin)');
  if (typeof value === 'string') {
    if (value.startsWith('/')) return prefix + value.slice(1);
    if (value.includes('href="/') || value.includes('src="/'))
      return value
        .replace(/href="(\/[^"]+)"/g, (_, p) => `href="${prefix}${p.slice(1)}"`)
        .replace(/src="(\/[^"]+)"/g, (_, p) => `src="${prefix}${p.slice(1)}"`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => makeRelativeContext(item, prefix, depth + 1));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, makeRelativeContext(v, prefix, depth + 1)]));
  return value;
}

// ---------------------------------------------------------------------------
// Funciones del pipeline (Fase 1a)
// ---------------------------------------------------------------------------

/**
 * Calcula el fingerprint de los plugins activos para invalidar la caché cuando cambia
 * el código fuente de un plugin local o el conjunto de plugins declarados.
 *
 * Para plugins locales (rutas relativas o absolutas) lee el contenido del archivo
 * y lo incluye en el hash, de modo que modificar el código de un plugin sin cambiar
 * su nombre de archivo invalida correctamente la caché.
 * Para paquetes npm se usa solo el identificador (el contenido no cambia sin
 * un cambio de versión en package.json, que sí altera el identificador resuelto).
 */
async function computePluginFingerprint(plugins: string[], cwd: string): Promise<string | undefined> {
  if (plugins.length === 0) return undefined;
  const hasher = new Bun.CryptoHasher('sha256');
  for (const pluginId of plugins) {
    hasher.update(pluginId);
    hasher.update('\0');
    if (isAbsolute(pluginId) || pluginId.startsWith('./') || pluginId.startsWith('../')) {
      const pluginPath = isAbsolute(pluginId) ? pluginId : resolve(cwd, pluginId);
      const content = await Bun.file(pluginPath)
        .text()
        .catch(() => '');
      hasher.update(content);
      hasher.update('\0');
    }
  }
  return hasher.digest('hex');
}

/**
 * Prepara el entorno de build: verifica Pandoc, carga config y plugins,
 * crea el BuildContext, limpia el outputDir, genera assets y construye las caches.
 */
async function setupBuildEnvironment(cwd: string, options: BuildOptions, log: (msg: string) => void): Promise<SetupResult> {
  const pandocVersion = await checkPandoc();
  const siteConfig = await loadSiteConfig(cwd);

  const plugins = await loadPlugins(siteConfig.plugins, cwd);
  const registry = new PluginRegistry();
  for (const plugin of plugins) registry.register(plugin);

  const ctx: BuildContext = {
    siteConfig,
    cwd,
    outputDir: options.outputDir ?? join(cwd, 'dist/web'),
    cssPath: options.cssPath ?? '',
    concurrency: options.concurrency ?? 4,
  };

  if (!options.incremental) await clean(ctx.outputDir);
  const cacheManager = new CacheManager(cwd);

  const pkg = (await Bun.file(join(import.meta.dir, '../../package.json')).json()) as { version: string };
  // El fingerprint invalida la caché cuando cambia el código fuente de plugins locales
  // o el conjunto de plugins declarados. Para plugins locales se hashea el contenido del
  // archivo; para paquetes npm basta con el identificador.
  const pluginFingerprint = await computePluginFingerprint(siteConfig.plugins, cwd);
  // --no-cache: omitir caché completamente (renderDocuments/composeDocuments aceptan undefined).
  const renderCache: RenderCache | undefined = options.noCache
    ? undefined
    : { manager: cacheManager, cliVersion: pkg.version, pandocVersion, pluginFingerprint };
  const composeCache: ComposeCache | undefined = options.noCache ? undefined : { manager: cacheManager, cliVersion: pkg.version, pluginFingerprint };

  const pandocPool = (await PandocPool.tryCreate()) ?? undefined;
  if (pandocPool) log('pandoc-server disponible: usando pool para conversiones');

  return {
    ctx,
    cacheManager,
    renderCache,
    composeCache,
    registry,
    hasPlugins: plugins.length > 0,
    pandocPool,
    cliVersion: pkg.version,
    pandocVersion,
    pluginFingerprint,
  };
}

/**
 * Descubre, clasifica y filtra borradores. Retorna el pool de documentos activos.
 */
async function runDiscovery(cwd: string, ctx: BuildContext, log: (msg: string) => void, noCache?: boolean): Promise<BuildDocument[]> {
  const sourceDocs = await discover(cwd, { noCache });
  log(`Descubiertos ${sourceDocs.length} documentos`);
  const classified = classifyDocuments(sourceDocs, ctx.siteConfig.theme, ctx.cwd);
  const allDocs = excludeDrafts(classified);
  const draftCount = classified.length - allDocs.length;
  if (draftCount > 0) log(`Excluidos ${draftCount} borrador${draftCount > 1 ? 'es' : ''} (draft:true)`);
  return allDocs;
}

/**
 * Construye el siteCtx base e inyecta menuHref/menuTitle si existe un documento
 * primario de tipo 'menu'. El contexto resultante se comparte por todas las páginas.
 */
function buildEnrichedSiteContext(ctx: BuildContext, allDocs: BuildDocument[]): TemplateContext {
  const siteCtx = buildSiteContext(ctx.siteConfig, ctx.cssPath);
  const primaryMenuDoc = allDocs.find((doc) => doc.type === 'menu' && doc.kind !== 'block');
  return primaryMenuDoc
    ? {
        ...siteCtx,
        menuHref: `/${primaryMenuDoc.relativePath.replace(/\.md$/, '.html')}`,
        menuTitle: escapeHtml(primaryMenuDoc.frontmatter.title || 'Menú'),
      }
    : siteCtx;
}

/**
 * Renderiza (Pandoc) los tipos primarios: file, author, event.
 * Construye el authorDocumentIndex a partir de los autores renderizados.
 * Estos datos son prerequisito para el pre-paso de bloques.
 */
async function runPrimaryRender(
  allDocs: BuildDocument[],
  ctx: BuildContext,
  renderCache: RenderCache | undefined,
  registry: PluginRegistry,
  stats?: RenderStats,
  pool?: PandocPool,
  cwd?: string,
  collectedKeys?: Set<string>,
): Promise<PrimaryRenderResult> {
  const fileDocs = allDocs.filter((doc) => doc.type === 'file' && doc.kind !== 'block');
  const renderedFileDocs = await renderDocuments(fileDocs, ctx.concurrency ?? 4, renderCache, registry, stats, pool, cwd, collectedKeys);

  const authorDocs = allDocs.filter((doc) => doc.type === 'author' && doc.kind !== 'block');
  const renderedAuthorDocs = await renderDocuments(authorDocs, ctx.concurrency ?? 4, renderCache, registry, stats, pool, cwd, collectedKeys);
  // Índice de autores por título normalizado (lowercase). Se construye aquí para que
  // esté disponible antes del pre-paso de bloques y del paso de contexto de páginas.
  const authorDocumentIndex = createAuthorDocumentIndex(renderedAuthorDocs);

  const eventDocs = allDocs.filter((doc) => doc.type === 'event' && doc.kind !== 'block');
  const renderedEventDocs = await renderDocuments(eventDocs, ctx.concurrency ?? 4, renderCache, registry, stats, pool, cwd, collectedKeys);

  return { renderedFileDocs, renderedAuthorDocs, renderedEventDocs, authorDocumentIndex };
}

/**
 * Pre-paso de bloques: renderiza todos los docs con kind === 'block', construye
 * sus contextos con datos reales, aplica templates para obtener innerHtml y
 * agrupa por región. El resultado se inyecta en finalSiteCtx para que los
 * region slots del layout se rellenen en todas las páginas.
 * Los bloques NO generan su propio archivo HTML de salida.
 *
 * Usa el type-graph para construir el contexto de cada bloque sin un switch hardcoded.
 * Si un tipo no tiene spec registrada en TYPE_STAGES, falla explícitamente.
 */
async function runBlocksPrestep(
  allDocs: BuildDocument[],
  ctx: BuildContext,
  renderCache: RenderCache | undefined,
  registry: PluginRegistry,
  enrichedSiteCtx: TemplateContext,
  primaryRendered: ReadonlyMap<DocumentType, BuildDocument[]>,
  authorDocumentIndex: AuthorDocumentIndex,
  stats?: RenderStats,
  pool?: PandocPool,
  cwd?: string,
  collectedKeys?: Set<string>,
): Promise<BlocksPrestepResult> {
  const allBlockDocs = allDocs.filter((doc) => doc.kind === 'block');
  const renderedBlockDocs = await renderDocuments(allBlockDocs, ctx.concurrency ?? 4, renderCache, registry, stats, pool, cwd, collectedKeys);
  const contextBlockDocs = renderedBlockDocs.map((doc) => {
    const spec = doc.type ? TYPE_STAGE_MAP.get(doc.type) : undefined;
    if (!spec) {
      throw new Error(
        `runBlocksPrestep: tipo de bloque sin spec en el type-graph: "${doc.type ?? 'undefined'}". ¿Falta añadir una TypeStageSpec en type-graph.ts?`,
      );
    }
    return { ...doc, templateContext: spec.buildBlockContext(doc, enrichedSiteCtx, primaryRendered, authorDocumentIndex) };
  });
  const regionBlocks = await renderBlocksToRegions(contextBlockDocs);
  return { finalSiteCtx: { ...enrichedSiteCtx, ...regionBlocks }, renderedBlockDocs };
}

/**
 * Fase de contexto: renderiza (Pandoc) los tipos restantes y construye el
/**
 * Fase final: relativiza contextos, compone HTML, escribe archivos,
 * ejecuta el hook afterBuild y poda la caché de render.
 */
async function runFinalization(
  allContextDocs: BuildDocument[],
  allRenderedDocs: BuildDocument[],
  ctx: BuildContext,
  composeCache: ComposeCache | undefined,
  renderCache: RenderCache | undefined,
  registry: PluginRegistry,
  hasPlugins: boolean,
  log: (msg: string) => void,
  composeStats: ComposeStats,
  pandocPool?: PandocPool,
  cwd?: string,
  incremental?: boolean,
  itemHashMap?: ReadonlyMap<string, string>,
  renderUsedKeys?: Set<string>,
): Promise<number> {
  const relativizedDocs = allContextDocs.map((doc) => ({
    ...doc,
    templateContext: makeRelativeContext(doc.templateContext, computeRootPrefix(doc.relativePath)) as TemplateContext,
  }));
  const tComposeStart = performance.now();
  const composedDocs = await composeDocuments(relativizedDocs, ctx, composeCache, registry, composeStats, itemHashMap);
  const composeMs = performance.now() - tComposeStart;
  const writtenDocs = await writeDocuments(composedDocs, ctx);
  log(`Escritos ${writtenDocs.length} archivos en ${ctx.outputDir}`);

  let generatedFiles: GeneratedFile[] = [];
  if (hasPlugins) {
    const docOutputPaths = writtenDocs.map((doc) => doc.relativePath.replace(/\.md$/, '.html'));
    const assetPaths: string[] = ['css/styles.css'];
    if (ctx.siteConfig.logo?.trim()) assetPaths.push(ctx.siteConfig.logo.trim());

    // generateFiles: recopilar y escribir archivos adicionales de plugins (sitemap, RSS, etc.)
    const docSummaries: PluginDocumentSummary[] = writtenDocs.map((doc) => ({
      relativePath: doc.relativePath,
      outputPath: doc.relativePath.replace(/\.md$/, '.html'),
      type: doc.type ?? 'file',
      frontmatter: doc.frontmatter as Record<string, unknown>,
    }));
    const initialContext = {
      outputDir: ctx.outputDir,
      outputPaths: [...assetPaths, ...docOutputPaths],
      siteConfig: ctx.siteConfig as unknown as Readonly<Record<string, unknown>>,
      documents: docSummaries,
    };
    generatedFiles = await registry.runGenerateFiles(initialContext);
    for (const file of generatedFiles) {
      await writeFile(join(ctx.outputDir, file.relativePath), file.content);
    }
    const generatedPaths = generatedFiles.map((f) => f.relativePath);

    await registry.runAfterBuild({ ...initialContext, outputPaths: [...initialContext.outputPaths, ...generatedPaths] });
  }

  // Actualizar manifiesto de salida y eliminar archivos huérfanos en modo incremental.
  // Se incluyen los archivos generados por plugins para que el purge incremental
  // los elimine si un plugin deja de generarlos en builds posteriores.
  const currentManifest = new Map(writtenDocs.map((doc) => [doc.relativePath, doc.outputPath ?? '']));
  for (const file of generatedFiles) {
    currentManifest.set(file.relativePath, join(ctx.outputDir, file.relativePath));
  }
  if (incremental && cwd) {
    const prevManifest = await loadOutputManifest(cwd);
    for (const [relPath, outputPath] of prevManifest) {
      if (!currentManifest.has(relPath) && outputPath) {
        await rm(outputPath, { force: true });
      }
    }
  }
  if (cwd) await saveOutputManifest(cwd, currentManifest);

  // Podar entradas obsoletas del scope 'render' usando las claves de todos los
  // documentos procesados en esta ejecución. Se hace al final para no eliminar
  // entradas que aún no han sido escritas por los batches posteriores.
  if (renderCache) {
    await renderCache.manager.prune('render', renderUsedKeys ?? new Set());
  }

  return composeMs;
}

// ---------------------------------------------------------------------------
// Punto de entrada público
// ---------------------------------------------------------------------------

export async function build(cwd: string, options: BuildOptions = {}): Promise<void> {
  // --dry-run: solo descubrir y clasificar; mostrar resumen sin generar salida.
  if (options.dryRun) {
    const dryConfig = await loadSiteConfig(cwd);
    const sourceDocs = await discover(cwd, { noCache: true });
    const classified = classifyDocuments(sourceDocs, dryConfig.theme, cwd);
    const allDocs = excludeDrafts(classified);
    const draftCount = classified.length - allDocs.length;
    const counts = new Map<string, number>();
    for (const doc of allDocs) {
      const type = doc.type ?? 'unknown';
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    process.stdout.write(`[dry-run] Se procesarían ${allDocs.length} documentos`);
    if (draftCount > 0) process.stdout.write(` (${draftCount} omitido${draftCount > 1 ? 'es' : ''} por draft:true)`);
    process.stdout.write(':\n');
    for (const [type, count] of [...counts.entries()].sort()) {
      process.stdout.write(`  ${type.padEnd(12)}: ${count}\n`);
    }
    return;
  }

  const log = options.verbose ? (msg: string) => process.stdout.write(`${msg}\n`) : (_msg: string) => undefined;

  const t0 = performance.now();
  const renderStats: RenderStats = { total: 0, cacheHits: 0 };
  const composeStats: ComposeStats = { total: 0, cacheHits: 0 };

  const { ctx, cacheManager, renderCache, composeCache, registry, hasPlugins, pandocPool, cliVersion, pandocVersion, pluginFingerprint } =
    await setupBuildEnvironment(cwd, options, log);
  try {
    // Hook beforeBuild: ejecutado antes de descubrir o procesar ningún documento.
    if (hasPlugins) {
      await registry.runBeforeBuild({
        cwd,
        outputDir: ctx.outputDir,
        siteConfig: ctx.siteConfig as unknown as Readonly<Record<string, unknown>>,
      });
    }
    const [allDocs, cssPath] = await Promise.all([
      runDiscovery(cwd, ctx, log, options.noCache),
      buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, {
        noTailwind: options.noTailwind,
        cacheManager: options.noCache ? undefined : cacheManager,
      }),
    ]);
    ctx.cssPath = cssPath;
    log(`Assets generados en ${ctx.outputDir}`);

    // Hook onDocumentDiscovered: notifica a los plugins de cada documento descubierto
    // y clasificado (excluyendo borradores), antes de que comience la fase de render.
    if (hasPlugins) {
      for (const doc of allDocs) {
        await registry.runOnDocumentDiscovered({
          sourcePath: doc.filePath,
          relativePath: doc.relativePath,
          type: doc.type ?? 'file',
          frontmatter: doc.frontmatter as Record<string, unknown>,
          body: doc.body,
        });
      }
    }

    const enrichedSiteCtx = buildEnrichedSiteContext(ctx, allDocs);
    const t1 = performance.now();
    // Conjunto de claves realmente usadas por renderDocuments (hits + writes).
    // Se pasa a todas las fases de render para que cada llamada acumule sus claves.
    // Permite que el prune elimine solo entradas genuinamente obsoletas.
    const renderUsedKeys = renderCache ? new Set<string>() : undefined;
    const { renderedFileDocs, renderedAuthorDocs, renderedEventDocs, authorDocumentIndex } = await runPrimaryRender(
      allDocs,
      ctx,
      renderCache,
      registry,
      renderStats,
      pandocPool,
      cwd,
      renderUsedKeys,
    );
    const primaryRendered = new Map<DocumentType, BuildDocument[]>([
      ['file', renderedFileDocs],
      ['author', renderedAuthorDocs],
      ['event', renderedEventDocs],
    ]);

    // Filtrado incremental: cuando se conocen los archivos modificados, limitar
    // el procesamiento de bloques y del context-phase a los docs afectados.
    // Si algún archivo global cambia (YAML de config, plantillas HTML) se omite
    // el filtrado y se reprocesa el sitio completo.
    const GLOBAL_CHANGE_PATTERNS = [/\.ya?ml$/, /\.html$/];
    const isGlobalChange =
      options.changedPaths !== undefined && [...options.changedPaths].some((p) => GLOBAL_CHANGE_PATTERNS.some((re) => re.test(p)));
    const affectedPaths = options.changedPaths && !isGlobalChange ? computeAffectedDocs(options.changedPaths, allDocs) : null;
    const pipelineDocs = affectedPaths ? allDocs.filter((d) => affectedPaths.has(d.relativePath)) : allDocs;

    const { finalSiteCtx, renderedBlockDocs } = await runBlocksPrestep(
      pipelineDocs,
      ctx,
      renderCache,
      registry,
      enrichedSiteCtx,
      primaryRendered,
      authorDocumentIndex,
      renderStats,
      pandocPool,
      cwd,
      renderUsedKeys,
    );
    const { allContextDocs, renderedMap } = await runContextPhaseWithTypeGraph(
      pipelineDocs,
      ctx,
      renderCache,
      registry,
      finalSiteCtx,
      primaryRendered,
      authorDocumentIndex,
      renderStats,
      pandocPool,
      cwd,
      renderUsedKeys,
    );
    // t2 se mide después del context phase para que pandocMs cubra todos los pasos
    // de renderizado: primary, blocks e índices (collection, authors, events, list).
    const t2 = performance.now();
    const allRenderedDocs = [...renderedMap.values()].flat().concat(renderedBlockDocs);
    // En modo incremental, pasar solo los docs afectados a compose/write para evitar
    // reprocesar documentos que no cambiaron. allRenderedDocs (completo) se usa solo
    // para la poda de la caché de render, que requiere todas las claves procesadas.
    const finalContextDocs = affectedPaths ? allContextDocs.filter((d) => affectedPaths.has(d.relativePath)) : allContextDocs;

    // Paso de exportación: genera PDF/EPUB si está configurado y no se pasó --no-export.
    const exportStats: ExportStats = { totalEpub: 0, totalPdf: 0, cacheHitsEpub: 0, cacheHitsPdf: 0 };
    const exportResults =
      ctx.siteConfig.export && !options.noExport
        ? await runExportDocuments(renderedMap, {
            config: ctx.siteConfig.export,
            outputDir: ctx.outputDir,
            cwd,
            lang: ctx.siteConfig.lang,
            concurrency: ctx.concurrency ?? 4,
            cliVersion,
            pandocVersion,
            cacheManager: options.noCache ? undefined : cacheManager,
            registry: hasPlugins ? registry : undefined,
            pluginFingerprint,
            stats: exportStats,
          })
        : [];
    if (exportResults.length > 0) {
      if (options.verbose) {
        const epubNew = exportStats.totalEpub - exportStats.cacheHitsEpub;
        const pdfNew = exportStats.totalPdf - exportStats.cacheHitsPdf;
        const parts: string[] = [];
        if (exportStats.totalEpub > 0) parts.push(`EPUB: ${epubNew} generados, ${exportStats.cacheHitsEpub} de caché`);
        if (exportStats.totalPdf > 0) parts.push(`PDF: ${pdfNew} generados, ${exportStats.cacheHitsPdf} de caché`);
        const detail = parts.length > 0 ? ` — ${parts.join(' | ')}` : '';
        log(`Exportación: ${exportResults.length} documento${exportResults.length > 1 ? 's' : ''}${detail}`);
      } else {
        log(`Exportados ${exportResults.length} documento${exportResults.length > 1 ? 's' : ''} (PDF/EPUB)`);
      }
    }

    // Inyectar enlaces de descarga en el templateContext de los docs con exportación.
    const docsWithLinks = injectDownloadLinks(finalContextDocs, exportResults, ctx.outputDir);

    // Mapa de relativePath → sourceHash: solo necesario cuando la caché de compose está activa.
    // Con --no-cache composeCache es undefined y construir el mapa sería trabajo O(n) sin uso.
    const itemHashMap = composeCache ? new Map(allDocs.map((d) => [d.relativePath, d.sourceHash])) : undefined;

    // En builds incrementales (affectedPaths filtra un subset) desactivar la poda de compose
    // para no eliminar entradas válidas de documentos que no se procesaron en este batch.
    const effectiveComposeCache = composeCache && affectedPaths ? { ...composeCache, skipPrune: true } : composeCache;

    const composeMs = await runFinalization(
      docsWithLinks,
      allRenderedDocs,
      ctx,
      effectiveComposeCache,
      renderCache,
      registry,
      hasPlugins,
      log,
      composeStats,
      pandocPool,
      cwd,
      options.incremental === true,
      itemHashMap,
      renderUsedKeys,
    );
    const t3 = performance.now();

    if (options.verbose) {
      const pandocMs = ((t2 - t1) / 1000).toFixed(1);
      const composeMsStr = (composeMs / 1000).toFixed(1);
      const totalS = ((t3 - t0) / 1000).toFixed(1);
      const pandocReal = renderStats.total - renderStats.cacheHits;
      process.stdout.write(
        `build: pandoc — ${pandocReal} conversión${pandocReal !== 1 ? 'es' : ''} en ${pandocMs}s (${renderStats.cacheHits} desde caché)\n`,
      );
      process.stdout.write(
        `build: compose — ${composeStats.total} documento${composeStats.total !== 1 ? 's' : ''} en ${composeMsStr}s (${composeStats.cacheHits} desde caché)\n`,
      );
      process.stdout.write(`build: completado en ${totalS}s\n`);
    }
  } finally {
    pandocPool?.dispose();
  }
}
