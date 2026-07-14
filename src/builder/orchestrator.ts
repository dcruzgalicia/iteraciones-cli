import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import dictumPlugin from '../../pandoc/plugins/dictum-plugin.js';
import { CacheManager } from '../cache/cache-manager.js';
import { hash } from '../cache/hasher.js';
import { loadOutputManifest, saveOutputManifest } from '../cache/output-manifest.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { ProgressTracker } from '../output/progress.js';
import { clean, writeFile } from '../output/writer.js';
import { loadPlugins } from '../plugin/loader.js';
import { PluginRegistry } from '../plugin/registry.js';
import type { GeneratedFile, PluginClassifiedDocument, PluginDocumentGraph, PluginDocumentSummary } from '../plugin/types.js';
import { PandocPool } from '../services/pandoc-pool.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import type { TemplateContext } from '../template/render/context.js';
import { buildAssets } from './assets.js';
import { createAuthorDocumentIndex } from './context/authors.js';
import { buildSiteContext } from './context/site.js';
import {
  type ExportRunOptions,
  type ExportStats,
  injectCoverIntoListItems,
  injectDownloadLinks,
  injectDownloadLinksIntoListItems,
  runExportDocuments,
} from './export/runner.js';
import { EXPORTABLE_TYPES } from './export/types.js';
import { buildDocumentGraph } from './graph-exporter.js';
import { escapeHtml } from './html.js';
import { classifyDocuments } from './pipeline/classify.js';
import { type ComposeCache, type ComposeStats, composeDocuments, renderBlocksToRegions } from './pipeline/compose.js';
import { computeAffectedDocs } from './pipeline/dependency-resolver.js';
import { discover } from './pipeline/discover.js';
import { type RenderCache, type RenderStats, renderDocuments } from './pipeline/render.js';
import { runContextPhaseWithTypeGraph } from './pipeline/runner.js';
import { TYPE_STAGE_MAP, VALID_TYPES } from './pipeline/type-graph.js';
import { writeDocuments } from './pipeline/write.js';
import { computeSlug, docHref, docHtmlPath } from './slug.js';
import type { AuthorDocumentIndex, BuildContext, BuildDocument, DocumentKind, DocumentType } from './types.js';

/**
 * Estado capturado después del build para permitir exportación on-demand en serve mode.
 * Contiene el renderedMap con todos los documentos procesados y las opciones de exportación.
 */
export interface OnDemandExportState {
  renderedMap: ReadonlyMap<DocumentType, BuildDocument[]>;
  exportOptions: ExportRunOptions;
}

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
  /**
   * Callback invocado con el estado necesario para exportación on-demand después de que
   * renderedMap esté listo. Solo se llama si el proyecto tiene `export` configurado.
   * Permite a serve.ts capturar el contexto para generar PDFs bajo demanda sin activar
   * la exportación completa (noExport sigue teniendo efecto).
   */
  onExportStateReady?: (state: OnDemandExportState) => void;
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
  /** Rutas absolutas a filtros Pandoc Lua declarados en la configuración. */
  luaFilters: string[];
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
    const isLocalPath = isAbsolute(pluginId) || pluginId.startsWith('./') || pluginId.startsWith('../');
    // Los filtros Lua sin prefijo de ruta también son archivos locales (se resuelven desde cwd en resolveLuaFilter).
    const isSimpleLua = !isLocalPath && pluginId.endsWith('.lua');
    if (isLocalPath || isSimpleLua) {
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

  const { plugins, luaFilters } = await loadPlugins(siteConfig.plugins, cwd);
  const registry = new PluginRegistry();
  for (const plugin of plugins) registry.register(plugin);
  // Plugin built-in: transforma fenced divs .dictum a LaTeX en exportación PDF
  registry.register(dictumPlugin);

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
  const pluginPaths = [...siteConfig.plugins, 'pandoc/plugins/dictum-plugin.ts'];
  const pluginFingerprint = await computePluginFingerprint(pluginPaths, cwd);
  // --no-cache: omitir caché completamente (renderDocuments/composeDocuments aceptan undefined).
  const renderCache: RenderCache | undefined = options.noCache
    ? undefined
    : {
        manager: cacheManager,
        cliVersion: pkg.version,
        pandocVersion,
        pluginFingerprint,
      };
  const composeCache: ComposeCache | undefined = options.noCache ? undefined : { manager: cacheManager, cliVersion: pkg.version, pluginFingerprint };

  const pandocPool = (await PandocPool.tryCreate()) ?? undefined;
  if (pandocPool) log('pandoc-server disponible: usando pool para conversiones');

  return {
    ctx,
    cacheManager,
    renderCache,
    composeCache,
    registry,
    hasPlugins: true,
    pandocPool,
    cliVersion: pkg.version,
    pandocVersion,
    pluginFingerprint,
    luaFilters,
  };
}

/**
 * Descubre, clasifica y filtra borradores. Retorna el pool de documentos activos.
 */
async function runDiscovery(cwd: string, ctx: BuildContext, noCache?: boolean): Promise<BuildDocument[]> {
  const sourceDocs = await discover(cwd, { noCache });
  const classified = classifyDocuments(sourceDocs, ctx.siteConfig.format?.html?.theme, ctx.cwd);
  const allDocs = excludeDrafts(classified);
  const draftCount = classified.length - allDocs.length;
  if (draftCount > 0) {
    // Registrar en stderr para que no se pierda ni mezcle con stdout
    process.stderr.write(`[iteraciones] ${draftCount} borrador${draftCount > 1 ? 'es' : ''} excluido${draftCount > 1 ? 's' : ''} (draft:true)\n`);
  }
  return allDocs;
}

/**
 * Lee el contenido del logo SVG (el del proyecto o el por defecto del paquete)
 * para inyectarlo inline en las templates con currentColor heredado del tema.
 * Devuelve undefined si el logo no es SVG o no se pudo leer.
 */
async function readLogoSvgContent(ctx: BuildContext): Promise<string | undefined> {
  const logo = ctx.siteConfig.logo?.trim();
  let svgPath: string;
  const isSvg = logo ? logo.endsWith('.svg') : true; // El logo por defecto es SVG

  if (logo && isSvg) {
    svgPath = join(ctx.cwd, logo);
  } else if (!logo) {
    const pkgRoot = join(import.meta.dir, '../..');
    svgPath = join(pkgRoot, 'themes', 'default', 'logo.svg');
  } else {
    return undefined; // Logo no-SVG, no se puede hacer inline
  }

  try {
    const content = await Bun.file(svgPath).text();
    if (content.trimStart().startsWith('<svg') || content.trimStart().startsWith('<?xml')) {
      return content;
    }
    return undefined;
  } catch {
    if (logo) {
      process.stderr.write(`\r\x1b[K⚠ no se pudo leer el SVG del logo en "${svgPath}"\n`);
    }
    return undefined;
  }
}

/**
 * Construye el siteCtx base e inyecta menuHref/menuTitle si existe un documento
 * primario de tipo 'menu'. El contexto resultante se comparte por todas las páginas.
 */
function buildEnrichedSiteContext(ctx: BuildContext, allDocs: BuildDocument[], logoSvg?: string): TemplateContext {
  const siteCtx = buildSiteContext(ctx.siteConfig, ctx.cssPath);
  const primaryMenuDoc = allDocs.find((doc) => doc.type === 'menu' && doc.kind !== 'block');
  const base = primaryMenuDoc
    ? {
        ...siteCtx,
        menuHref: docHref(primaryMenuDoc),
        menuTitle: escapeHtml(primaryMenuDoc.frontmatter.title || 'Menú'),
      }
    : siteCtx;

  if (logoSvg) {
    return { ...base, 'site-logo-svg': logoSvg };
  }
  return base;
}

/**
 * Renderiza (Pandoc) los tipos primarios: file, author, event.
 * Construye el authorDocumentIndex a partir de los autores renderizados.
 * Estos datos son prerequisito para el pre-paso de bloques.
 */
/**
 * Resuelve rutas globales de bibliography y csl desde la configuración del sitio.
 */
function resolveGlobalExportPaths(ctx: BuildContext): {
  globalBibliography?: string;
  globalCsl?: string;
} {
  const pdfCfg = ctx.siteConfig.format?.pdf;
  if (!pdfCfg) return {};
  const cwd = ctx.cwd;
  const bibPath = pdfCfg.bibliography ? join(cwd, pdfCfg.bibliography) : undefined;
  const cslPath = pdfCfg.csl ? join(cwd, pdfCfg.csl) : undefined;
  return {
    globalBibliography: bibPath && existsSync(bibPath) ? bibPath : undefined,
    globalCsl: cslPath && existsSync(cslPath) ? cslPath : undefined,
  };
}

async function runPrimaryRender(
  allDocs: BuildDocument[],
  ctx: BuildContext,
  renderCache: RenderCache | undefined,
  registry: PluginRegistry,
  stats?: RenderStats,
  pool?: PandocPool,
  cwd?: string,
  collectedKeys?: Set<string>,
  luaFilters?: readonly string[],
  onFileProcessed?: (report: import('../output/progress.js').RenderFileReport) => void,
): Promise<PrimaryRenderResult> {
  const { globalBibliography, globalCsl } = resolveGlobalExportPaths(ctx);
  const fileDocs = allDocs.filter((doc) => doc.type === 'file' && doc.kind !== 'block');
  const renderedFileDocs = await renderDocuments(
    fileDocs,
    ctx.concurrency ?? 4,
    renderCache,
    registry,
    stats,
    pool,
    cwd,
    collectedKeys,
    luaFilters,
    globalBibliography,
    globalCsl,
    onFileProcessed,
  );

  const authorDocs = allDocs.filter((doc) => doc.type === 'author' && doc.kind !== 'block');
  const renderedAuthorDocs = await renderDocuments(
    authorDocs,
    ctx.concurrency ?? 4,
    renderCache,
    registry,
    stats,
    pool,
    cwd,
    collectedKeys,
    luaFilters,
    globalBibliography,
    globalCsl,
    onFileProcessed,
  );
  // Índice de autores por título normalizado (lowercase). Se construye aquí para que
  // esté disponible antes del pre-paso de bloques y del paso de contexto de páginas.
  const authorDocumentIndex = createAuthorDocumentIndex(renderedAuthorDocs);

  const eventDocs = allDocs.filter((doc) => doc.type === 'event' && doc.kind !== 'block');
  const renderedEventDocs = await renderDocuments(
    eventDocs,
    ctx.concurrency ?? 4,
    renderCache,
    registry,
    stats,
    pool,
    cwd,
    collectedKeys,
    luaFilters,
    globalBibliography,
    globalCsl,
    onFileProcessed,
  );

  return {
    renderedFileDocs,
    renderedAuthorDocs,
    renderedEventDocs,
    authorDocumentIndex,
  };
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
  luaFilters?: readonly string[],
  onFileProcessed?: (report: import('../output/progress.js').RenderFileReport) => void,
): Promise<BlocksPrestepResult> {
  const { globalBibliography, globalCsl } = resolveGlobalExportPaths(ctx);
  const allBlockDocs = allDocs.filter((doc) => doc.kind === 'block');
  const renderedBlockDocs = await renderDocuments(
    allBlockDocs,
    ctx.concurrency ?? 4,
    renderCache,
    registry,
    stats,
    pool,
    cwd,
    collectedKeys,
    luaFilters,
    globalBibliography,
    globalCsl,
    onFileProcessed,
  );
  const contextBlockDocs = renderedBlockDocs.map((doc) => {
    const spec = doc.type ? TYPE_STAGE_MAP.get(doc.type) : undefined;
    if (!spec) {
      throw new Error(
        `runBlocksPrestep: tipo de bloque sin spec en el type-graph: "${doc.type ?? 'undefined'}". ¿Falta añadir una TypeStageSpec en type-graph.ts?`,
      );
    }
    return {
      ...doc,
      templateContext: spec.buildBlockContext(doc, enrichedSiteCtx, primaryRendered, authorDocumentIndex),
    };
  });
  const regionBlocks = await renderBlocksToRegions(contextBlockDocs);
  return {
    finalSiteCtx: { ...enrichedSiteCtx, ...regionBlocks },
    renderedBlockDocs,
  };
}

/**
 * Fase final: relativiza contextos, compone HTML, escribe archivos,
 * ejecuta el hook afterBuild y poda la caché de render.
 */
async function runFinalization(
  allContextDocs: BuildDocument[],
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
  onFileProcessed?: (report: import('../output/progress.js').RenderFileReport) => void,
): Promise<number> {
  const generateHtml = ctx.siteConfig.format?.html?.generate !== false;

  let composeMs = 0;
  const writtenDocs: BuildDocument[] = [];
  if (generateHtml) {
    const relativizedDocs = allContextDocs.map((doc) => ({
      ...doc,
      templateContext: makeRelativeContext(doc.templateContext, computeRootPrefix(doc.relativePath)) as TemplateContext,
    }));
    const tComposeStart = performance.now();
    const composedDocs = await composeDocuments(relativizedDocs, ctx, composeCache, registry, composeStats, itemHashMap, onFileProcessed);
    composeMs = performance.now() - tComposeStart;
    const docs = await writeDocuments(composedDocs, ctx);
    writtenDocs.push(...docs);
    log(`Escritos ${docs.length} archivos en ${ctx.outputDir}`);
  } else {
    log('HTML desactivado: omitiendo generación de HTML');
  }

  let generatedFiles: GeneratedFile[] = [];
  if (hasPlugins) {
    const docOutputPaths = writtenDocs.map((doc) => docHtmlPath(doc));
    const logoPath = ctx.siteConfig.logo?.trim() || 'logo.svg';
    const assetPaths: string[] = ['css/styles.css', logoPath];

    // generateFiles: recopilar y escribir archivos adicionales de plugins (sitemap, RSS, etc.)
    const docSummaries: PluginDocumentSummary[] = writtenDocs.map((doc) => ({
      relativePath: doc.relativePath,
      outputPath: docHtmlPath(doc),
      type: doc.type ?? 'file',
      frontmatter: doc.frontmatter as Record<string, unknown>,
    }));
    const graph = buildDocumentGraph(docSummaries);
    const initialContext = {
      outputDir: ctx.outputDir,
      outputPaths: [...assetPaths, ...docOutputPaths],
      siteConfig: ctx.siteConfig as unknown as Readonly<Record<string, unknown>>,
      documents: docSummaries,
      graph,
    };
    generatedFiles = await registry.runGenerateFiles(initialContext);
    for (const file of generatedFiles) {
      await writeFile(join(ctx.outputDir, file.relativePath), file.content);
    }
    const generatedPaths = generatedFiles.map((f) => f.relativePath);

    await registry.runAfterBuild({
      ...initialContext,
      outputPaths: [...initialContext.outputPaths, ...generatedPaths],
    });
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
  // Si renderUsedKeys no está disponible (undefined), se omite el prune para
  // evitar borrar la caché entera por error.
  if (renderCache && renderUsedKeys) {
    await renderCache.manager.prune('render', renderUsedKeys);
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
    const classified = classifyDocuments(sourceDocs, dryConfig.format?.html?.theme, cwd);
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

  const progress = new ProgressTracker({ verbose: options.verbose ?? false });
  const log = (msg: string) => progress.log(msg);

  const renderStats: RenderStats = { total: 0, cacheHits: 0 };
  const composeStats: ComposeStats = { total: 0, cacheHits: 0 };

  const { ctx, cacheManager, renderCache, composeCache, registry, hasPlugins, pandocPool, cliVersion, pandocVersion, pluginFingerprint, luaFilters } =
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
    progress.startPhase('discovery');
    const [rawDocs, cssPath] = await Promise.all([
      runDiscovery(cwd, ctx, options.noCache),
      buildAssets(ctx.outputDir, ctx.cwd, ctx.siteConfig, {
        noTailwind: options.noTailwind,
        cacheManager: options.noCache ? undefined : cacheManager,
      }),
    ]);
    ctx.cssPath = cssPath;
    progress.completePhase();

    // Hook onDocumentClassified: permite a plugins sobreescribir type/kind/templatePath
    // tras la clasificación automática, antes del render. Retornar null excluye el documento.
    let allDocs = rawDocs;
    if (hasPlugins) {
      const classified: BuildDocument[] = [];
      for (const doc of rawDocs) {
        const result = await registry.runOnDocumentClassified({
          sourcePath: doc.filePath,
          relativePath: doc.relativePath,
          type: doc.type ?? 'file',
          kind: doc.kind ?? 'page',
          templatePath: doc.templatePath,
          frontmatter: doc.frontmatter as Readonly<Record<string, unknown>>,
          body: doc.body,
        } satisfies PluginClassifiedDocument);
        if (result === null) continue;
        if (!VALID_TYPES.has(result.type as DocumentType)) {
          throw new Error(`[plugin:onDocumentClassified] tipo inválido "${result.type}"; valores válidos: ${[...VALID_TYPES].join(', ')}`);
        }
        if (result.kind !== 'page' && result.kind !== 'block') {
          throw new Error(`[plugin:onDocumentClassified] kind inválido "${result.kind}"; valores válidos: page, block`);
        }
        classified.push({
          ...doc,
          type: result.type as DocumentType,
          kind: result.kind as DocumentKind,
          templatePath: result.templatePath,
        });
      }
      allDocs = classified;
    }

    // Hook onDocumentDiscovered: permite a plugins filtrar o modificar el pool de documentos.
    // Retornar null excluye el documento; retornar un objeto aplica cambios de body/frontmatter/relativePath.
    if (hasPlugins) {
      const discovered: BuildDocument[] = [];
      for (const doc of allDocs) {
        const result = await registry.runOnDocumentDiscovered({
          sourcePath: doc.filePath,
          relativePath: doc.relativePath,
          type: doc.type ?? 'file',
          frontmatter: doc.frontmatter as Readonly<Record<string, unknown>>,
          body: doc.body,
        });
        if (result === null) continue;
        discovered.push({
          ...doc,
          relativePath: result.relativePath,
          frontmatter: result.frontmatter as BuildDocument['frontmatter'],
          body: result.body,
        });
      }
      allDocs = discovered;
    }

    // Compute output-path slugs for all documents.
    // Los archivos llamados index.md siempre conservan su nombre (index.html).
    for (const doc of allDocs) {
      const filenameStem = basename(doc.relativePath, '.md');
      doc.slug = filenameStem === 'index' ? undefined : computeSlug(doc.frontmatter);
    }

    const logoSvg = await readLogoSvgContent(ctx);
    const enrichedSiteCtx = buildEnrichedSiteContext(ctx, allDocs, logoSvg);
    progress.startPhase('render', allDocs.length);
    // Conjunto de claves realmente usadas por renderDocuments (hits + writes).
    // Se pasa a todas las fases de render para que cada llamada acumule sus claves.
    // Permite que el prune elimine solo entradas genuinamente obsoletas.
    const renderUsedKeys = renderCache ? new Set<string>() : undefined;
    const onFileProcessed = (report: import('../output/progress.js').RenderFileReport) => progress.reportFile(report);
    const { renderedFileDocs, renderedAuthorDocs, renderedEventDocs, authorDocumentIndex } = await runPrimaryRender(
      allDocs,
      ctx,
      renderCache,
      registry,
      renderStats,
      pandocPool,
      cwd,
      renderUsedKeys,
      luaFilters,
      onFileProcessed,
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
      luaFilters,
      onFileProcessed,
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
      luaFilters,
      onFileProcessed,
    );
    progress.completePhase(); // fin de render

    // En modo incremental, pasar solo los docs afectados a compose/write para evitar
    // reprocesar documentos que no cambiaron.
    const finalContextDocs = affectedPaths ? allContextDocs.filter((d) => affectedPaths.has(d.relativePath)) : allContextDocs;

    // Notificar el estado de exportacion on-demand (sirve a serve.ts para PDF bajo demanda).
    // Se invoca siempre que haya export configurado, independientemente de noExport.
    if (options.onExportStateReady && ctx.siteConfig.format?.pdf?.generate === true) {
      options.onExportStateReady({
        renderedMap,
        exportOptions: {
          config: ctx.siteConfig.format ?? {},
          outputDir: ctx.outputDir,
          cwd,
          lang: ctx.siteConfig.lang,
          concurrency: ctx.concurrency ?? 4,
          cliVersion,
          pandocVersion,
          cacheManager: options.noCache ? undefined : cacheManager,
          registry: hasPlugins ? registry : undefined,
          pluginFingerprint,
        },
      });
    }

    // Paso de exportacion: genera PDF/EPUB/MD si esta configurado y no se paso --no-export.
    const exportStats: ExportStats = {
      totalEpub: 0,
      totalPdf: 0,
      totalMd: 0,
      cacheHitsEpub: 0,
      cacheHitsPdf: 0,
      cacheHitsMd: 0,
    };
    const formatCfg = ctx.siteConfig.format;
    const hasExport =
      (formatCfg?.pdf?.generate === true || formatCfg?.epub?.generate === true || formatCfg?.markdown?.generate === true) && !options.noExport;
    if (hasExport && formatCfg) {
      // Calcular total de PDFs para la barra de progreso (misma logica que runExportDocuments).
      let exportTotal = 0;
      const countExportDocs = (type: DocumentType): number => {
        const docs = (renderedMap.get(type) ?? []).filter((d) => d.kind !== 'block');
        let count = 0;
        for (const d of docs) {
          const raw = d.frontmatter['export'];
          const skipped = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>)['skip'] === true;
          if (skipped) continue;
          count += d.type === 'author' ? 2 : 1;
        }
        return count;
      };

      if (formatCfg.pdf?.generate === true) {
        for (const type of EXPORTABLE_TYPES) {
          exportTotal += countExportDocs(type);
        }
      }
      if (formatCfg.markdown?.generate === true) {
        for (const type of EXPORTABLE_TYPES) {
          const docs = (renderedMap.get(type) ?? []).filter((d) => d.kind !== 'block');
          for (const d of docs) {
            const raw = d.frontmatter['export'];
            const skipped = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>)['skip'] === true;
            if (skipped) continue;
            exportTotal++;
          }
        }
      }
      progress.startPhase('export', exportTotal);
    }
    const exportRenderedMap = affectedPaths
      ? new Map<DocumentType, BuildDocument[]>(
          [...renderedMap].map(([type, docs]) => [type, docs.filter((doc) => affectedPaths.has(doc.relativePath))]),
        )
      : renderedMap;
    const exportResults =
      hasExport && formatCfg
        ? await runExportDocuments(exportRenderedMap, {
            config: formatCfg,
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
            onExportProgress: (relativePath, cacheHit) =>
              progress.reportFile({
                relativePath,
                durationMs: 0,
                cacheHit,
                phase: 'export',
              }),
          })
        : [];
    if (exportResults.length > 0) {
      const epubNew = exportStats.totalEpub - exportStats.cacheHitsEpub;
      const pdfNew = exportStats.totalPdf - exportStats.cacheHitsPdf;
      const mdNew = exportStats.totalMd - exportStats.cacheHitsMd;
      const parts: string[] = [];
      if (exportStats.totalEpub > 0) parts.push(`EPUB: ${epubNew} generados, ${exportStats.cacheHitsEpub} de caché`);
      if (exportStats.totalPdf > 0) parts.push(`PDF: ${pdfNew} generados, ${exportStats.cacheHitsPdf} de caché`);
      if (exportStats.totalMd > 0) parts.push(`MD: ${mdNew} generados, ${exportStats.cacheHitsMd} de caché`);
      const detail = parts.length > 0 ? ` — ${parts.join(' | ')}` : '';
      progress.log(`Exportación: ${exportResults.length} documento${exportResults.length > 1 ? 's' : ''}${detail}`);
    }
    if (hasExport) progress.completePhase(); // fin de export

    // Inyectar enlaces de descarga en los docs exportables, propagarlos a los ítems
    // y luego añadir la miniatura `cover-image` a los list-items.
    const docsWithExportLinks = injectDownloadLinks(finalContextDocs, exportResults, ctx.outputDir);
    const docsWithListLinks = injectDownloadLinksIntoListItems(docsWithExportLinks);
    const docsWithLinks = injectCoverIntoListItems(docsWithListLinks);

    // Mapa de relativePath → sourceHash: solo necesario cuando la caché de compose está activa.
    // Con --no-cache composeCache es undefined y construir el mapa sería trabajo O(n) sin uso.
    const itemHashMap = composeCache ? new Map(allDocs.map((d) => [d.relativePath, d.sourceHash])) : undefined;

    // En builds incrementales (affectedPaths filtra un subset) desactivar la poda de compose
    // para no eliminar entradas válidas de documentos que no se procesaron en este batch.
    const effectiveComposeCache = composeCache && affectedPaths ? { ...composeCache, skipPrune: true } : composeCache;

    progress.startPhase('compose', finalContextDocs.length);
    await runFinalization(
      docsWithLinks,
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
      onFileProcessed,
    );
    progress.completePhase(); // fin de compose

    const htmlOn = formatCfg?.html?.generate !== false;
    const pdfOn = formatCfg?.pdf?.generate === true;
    const epubOn = formatCfg?.epub?.generate === true;
    const mdOn = formatCfg?.markdown?.generate === true;
    const docCount = htmlOn || pdfOn || epubOn || mdOn ? allDocs.length : 0;
    progress.finish(docCount);
  } finally {
    pandocPool?.dispose();
  }
}
