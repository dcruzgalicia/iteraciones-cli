import { join } from 'node:path';
import { CacheManager } from '../cache/cache-manager.js';
import { hash } from '../cache/hasher.js';
import { loadSiteConfig } from '../config/config-loader.js';
import { clean } from '../output/writer.js';
import { loadPlugins } from '../plugin/loader.js';
import { PluginRegistry } from '../plugin/registry.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import type { TemplateContext } from '../template/render/context.js';
import { buildAssets } from './assets.js';
import { buildRelatedAuthorsContext, createAuthorDocumentIndex } from './context/authors.js';
import { buildSiteContext } from './context/site.js';
import { escapeHtml } from './html.js';
import { classifyDocuments } from './pipeline/classify.js';
import { type ComposeCache, composeDocuments, renderBlocksToRegions } from './pipeline/compose.js';
import { buildAuthorPipelineContext, buildAuthorsPipelineContext, buildPagedAuthorsPipelineContexts } from './pipeline/context/authors.js';
import { buildCardPipelineContext } from './pipeline/context/card.js';
import { buildCollectionPipelineContext, buildPagedCollectionPipelineContexts } from './pipeline/context/collection.js';
import { buildEventPipelineContext, buildEventsPipelineContext, buildPagedEventsPipelineContexts } from './pipeline/context/event.js';
import { buildContext } from './pipeline/context/index.js';
import { buildListPipelineContext, buildPagedListPipelineContexts } from './pipeline/context/list.js';
import { buildMenuPipelineContext } from './pipeline/context/menu.js';
import { mergeContexts } from './pipeline/context/merge.js';
import { discover } from './pipeline/discover.js';
import { type RenderCache, renderDocuments } from './pipeline/render.js';
import { writeDocuments } from './pipeline/write.js';
import type { AuthorDocumentIndex, BuildContext, BuildDocument } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  cssPath?: string;
  concurrency?: number;
  /** Omite lectura y escritura de la caché; siempre hace build completo. */
  noCache?: boolean;
  /** Omite la generación de CSS con Tailwind; copia fonts y logo igualmente. */
  noTailwind?: boolean;
  /** Muestra los documentos que se procesarían sin generar salida. */
  dryRun?: boolean;
  /** Imprime información adicional de progreso durante el build. */
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Interfaces internas de resultado entre funciones del pipeline
// ---------------------------------------------------------------------------

interface SetupResult {
  ctx: BuildContext;
  renderCache: RenderCache | undefined;
  composeCache: ComposeCache | undefined;
  registry: PluginRegistry;
  hasPlugins: boolean;
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

interface ContextPhaseResult {
  allContextDocs: BuildDocument[];
  allRenderedDocs: BuildDocument[];
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

function buildBlockTypeContext(
  doc: Parameters<typeof buildContext>[0],
  siteCtx: TemplateContext,
  collectionPool: BuildDocument[],
  renderedFileDocs: Parameters<typeof buildAuthorPipelineContext>[2],
  renderedAuthorDocs: Parameters<typeof buildAuthorsPipelineContext>[2],
  renderedEventDocs: Parameters<typeof buildEventsPipelineContext>[2],
  authorDocumentIndex: AuthorDocumentIndex,
): TemplateContext {
  switch (doc.type) {
    case 'collection':
      return buildCollectionPipelineContext(doc, siteCtx, collectionPool, authorDocumentIndex);
    case 'author':
      return buildAuthorPipelineContext(doc, siteCtx, renderedFileDocs);
    case 'authors':
      return buildAuthorsPipelineContext(doc, siteCtx, renderedAuthorDocs);
    case 'event':
      return buildEventPipelineContext(doc, siteCtx, authorDocumentIndex);
    case 'events':
      return buildEventsPipelineContext(doc, siteCtx, renderedEventDocs);
    case 'menu':
      return buildMenuPipelineContext(doc, siteCtx);
    case 'card':
      return buildCardPipelineContext(doc, siteCtx);
    case 'list':
      return buildListPipelineContext(doc, siteCtx, renderedFileDocs, authorDocumentIndex);
    default:
      return mergeContexts(buildContext(doc, siteCtx, authorDocumentIndex), buildRelatedAuthorsContext(doc, authorDocumentIndex));
  }
}

// ---------------------------------------------------------------------------
// Funciones del pipeline (Fase 1a)
// ---------------------------------------------------------------------------

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

  await clean(ctx.outputDir);
  ctx.cssPath = await buildAssets(ctx.outputDir, ctx.cwd, siteConfig, { noTailwind: options.noTailwind });
  log(`Assets generados en ${ctx.outputDir}`);

  const pkg = (await Bun.file(join(import.meta.dir, '../../package.json')).json()) as { version: string };
  const cacheManager = new CacheManager(cwd);
  // El fingerprint invalida la caché cuando cambia el conjunto de plugins declarados en
  // _iteraciones.yaml. Nota: no detecta cambios en el código fuente de un plugin si su
  // ruta no cambia; en ese caso se debe limpiar la caché manualmente.
  const pluginFingerprint = siteConfig.plugins.length > 0 ? hash(JSON.stringify(siteConfig.plugins)) : undefined;
  // --no-cache: omitir caché completamente (renderDocuments/composeDocuments aceptan undefined).
  const renderCache: RenderCache | undefined = options.noCache
    ? undefined
    : { manager: cacheManager, cliVersion: pkg.version, pandocVersion, pluginFingerprint };
  const composeCache: ComposeCache | undefined = options.noCache ? undefined : { manager: cacheManager, cliVersion: pkg.version, pluginFingerprint };

  return { ctx, renderCache, composeCache, registry, hasPlugins: plugins.length > 0 };
}

/**
 * Descubre, clasifica y filtra borradores. Retorna el pool de documentos activos.
 */
async function runDiscovery(cwd: string, ctx: BuildContext, log: (msg: string) => void): Promise<BuildDocument[]> {
  const sourceDocs = await discover(cwd);
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
): Promise<PrimaryRenderResult> {
  const fileDocs = allDocs.filter((doc) => doc.type === 'file' && doc.kind !== 'block');
  const renderedFileDocs = await renderDocuments(fileDocs, ctx.concurrency ?? 4, renderCache, registry);

  const authorDocs = allDocs.filter((doc) => doc.type === 'author' && doc.kind !== 'block');
  const renderedAuthorDocs = await renderDocuments(authorDocs, ctx.concurrency ?? 4, renderCache, registry);
  // Índice de autores por título normalizado (lowercase). Se construye aquí para que
  // esté disponible antes del pre-paso de bloques y del paso de contexto de páginas.
  const authorDocumentIndex = createAuthorDocumentIndex(renderedAuthorDocs);

  const eventDocs = allDocs.filter((doc) => doc.type === 'event' && doc.kind !== 'block');
  const renderedEventDocs = await renderDocuments(eventDocs, ctx.concurrency ?? 4, renderCache, registry);

  return { renderedFileDocs, renderedAuthorDocs, renderedEventDocs, authorDocumentIndex };
}

/**
 * Pre-paso de bloques: renderiza todos los docs con kind === 'block', construye
 * sus contextos con datos reales, aplica templates para obtener innerHtml y
 * agrupa por región. El resultado se inyecta en finalSiteCtx para que los
 * region slots del layout se rellenen en todas las páginas.
 * Los bloques NO generan su propio archivo HTML de salida.
 */
async function runBlocksPrestep(
  allDocs: BuildDocument[],
  ctx: BuildContext,
  renderCache: RenderCache | undefined,
  registry: PluginRegistry,
  enrichedSiteCtx: TemplateContext,
  renderedFileDocs: BuildDocument[],
  renderedAuthorDocs: BuildDocument[],
  renderedEventDocs: BuildDocument[],
  authorDocumentIndex: AuthorDocumentIndex,
): Promise<BlocksPrestepResult> {
  // El pool para bloques de tipo collection incluye los docs renderizados disponibles
  // en este punto del pipeline (file, author, event).
  const collectionBlockPool = [...renderedFileDocs, ...renderedAuthorDocs, ...renderedEventDocs];
  const allBlockDocs = allDocs.filter((doc) => doc.kind === 'block');
  const renderedBlockDocs = await renderDocuments(allBlockDocs, ctx.concurrency ?? 4, renderCache, registry);
  const contextBlockDocs = renderedBlockDocs.map((doc) => ({
    ...doc,
    templateContext: buildBlockTypeContext(
      doc,
      enrichedSiteCtx,
      collectionBlockPool,
      renderedFileDocs,
      renderedAuthorDocs,
      renderedEventDocs,
      authorDocumentIndex,
    ),
  }));
  const regionBlocks = await renderBlocksToRegions(contextBlockDocs);
  return { finalSiteCtx: { ...enrichedSiteCtx, ...regionBlocks }, renderedBlockDocs };
}

/**
 * Fase de contexto: renderiza (Pandoc) los tipos restantes y construye el
 * templateContext de cada documento. Retorna allContextDocs (listos para compose)
 * y allRenderedDocs (necesario para la poda de caché al final del build).
 */
async function runContextPhase(
  allDocs: BuildDocument[],
  ctx: BuildContext,
  renderCache: RenderCache | undefined,
  registry: PluginRegistry,
  finalSiteCtx: TemplateContext,
  renderedFileDocs: BuildDocument[],
  renderedAuthorDocs: BuildDocument[],
  renderedEventDocs: BuildDocument[],
  renderedBlockDocs: BuildDocument[],
  authorDocumentIndex: AuthorDocumentIndex,
): Promise<ContextPhaseResult> {
  const { listItemsLimit } = ctx.siteConfig;
  const concurrency = ctx.concurrency ?? 4;

  // file: se fusionan con buildRelatedAuthorsContext para rellenar el slot `authors`.
  const contextFileDocs = renderedFileDocs.map((doc) => ({
    ...doc,
    templateContext: mergeContexts(buildContext(doc, finalSiteCtx, authorDocumentIndex), buildRelatedAuthorsContext(doc, authorDocumentIndex)),
  }));

  // collection: lista curada por items: en frontmatter. Genera páginas si supera listItemsLimit.
  const collectionPool = [...renderedFileDocs, ...renderedAuthorDocs, ...renderedEventDocs];
  const collectionDocs = allDocs.filter((doc) => doc.type === 'collection' && doc.kind !== 'block');
  const renderedCollectionDocs = await renderDocuments(collectionDocs, concurrency, renderCache, registry);
  const contextCollectionDocs = renderedCollectionDocs.flatMap((doc) =>
    buildPagedCollectionPipelineContexts(doc, finalSiteCtx, collectionPool, listItemsLimit, authorDocumentIndex),
  );

  // author: contexto individual con publicaciones relacionadas (sin límite de listItemsLimit).
  const contextAuthorDocs = renderedAuthorDocs.map((doc) => ({
    ...doc,
    templateContext: buildAuthorPipelineContext(doc, finalSiteCtx, renderedFileDocs),
  }));

  // authors: índice paginado de autores.
  const authorsDocs = allDocs.filter((doc) => doc.type === 'authors' && doc.kind !== 'block');
  const renderedAuthorsDocs = await renderDocuments(authorsDocs, concurrency, renderCache, registry);
  const contextAuthorsDocs = renderedAuthorsDocs.flatMap((doc) =>
    buildPagedAuthorsPipelineContexts(doc, finalSiteCtx, renderedAuthorDocs, listItemsLimit),
  );

  // event: contexto individual; speakers resueltos desde authorDocumentIndex.
  const contextEventDocs = renderedEventDocs.map((doc) => ({
    ...doc,
    templateContext: buildEventPipelineContext(doc, finalSiteCtx, authorDocumentIndex),
  }));

  // events: índice paginado de eventos.
  const eventsDocs = allDocs.filter((doc) => doc.type === 'events' && doc.kind !== 'block');
  const renderedEventsDocs = await renderDocuments(eventsDocs, concurrency, renderCache, registry);
  const contextEventsDocs = renderedEventsDocs.flatMap((doc) =>
    buildPagedEventsPipelineContexts(doc, finalSiteCtx, renderedEventDocs, listItemsLimit),
  );

  // menu: renderizado opcional del cuerpo MD + contexto de navegación.
  const menuDocs = allDocs.filter((doc) => doc.type === 'menu' && doc.kind !== 'block');
  const renderedMenuDocs = await renderDocuments(menuDocs, concurrency, renderCache, registry);
  const contextMenuDocs = renderedMenuDocs.map((doc) => ({
    ...doc,
    templateContext: buildMenuPipelineContext(doc, finalSiteCtx),
  }));

  // card: solo kind 'page' (los bloques ya se procesaron en el pre-paso).
  const cardDocs = allDocs.filter((doc) => doc.type === 'card' && doc.kind !== 'block');
  const renderedCardDocs = await renderDocuments(cardDocs, concurrency, renderCache, registry);
  const contextCardDocs = renderedCardDocs.map((doc) => ({
    ...doc,
    templateContext: buildCardPipelineContext(doc, finalSiteCtx),
  }));

  // list: renderiza primero para incluirse en su propio pool (filters.type: [list]).
  const listDocs = allDocs.filter((doc) => doc.type === 'list' && doc.kind !== 'block');
  const renderedListDocs = await renderDocuments(listDocs, concurrency, renderCache, registry);
  const listCandidatePool = [
    ...renderedFileDocs,
    ...renderedAuthorDocs,
    ...renderedEventDocs,
    ...renderedCollectionDocs,
    ...renderedAuthorsDocs,
    ...renderedEventsDocs,
    ...renderedMenuDocs,
    ...renderedCardDocs,
    ...renderedListDocs,
  ];
  const contextListDocs = renderedListDocs.flatMap((doc) =>
    buildPagedListPipelineContexts(doc, finalSiteCtx, listCandidatePool, listItemsLimit, authorDocumentIndex),
  );

  const allContextDocs = [
    ...contextFileDocs,
    ...contextCollectionDocs,
    ...contextAuthorDocs,
    ...contextAuthorsDocs,
    ...contextEventDocs,
    ...contextEventsDocs,
    ...contextMenuDocs,
    ...contextCardDocs,
    ...contextListDocs,
  ];
  const allRenderedDocs = [
    ...renderedFileDocs,
    ...renderedAuthorDocs,
    ...renderedEventDocs,
    ...renderedBlockDocs,
    ...renderedCollectionDocs,
    ...renderedAuthorsDocs,
    ...renderedEventsDocs,
    ...renderedMenuDocs,
    ...renderedCardDocs,
    ...renderedListDocs,
  ];

  return { allContextDocs, allRenderedDocs };
}

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
): Promise<void> {
  const relativizedDocs = allContextDocs.map((doc) => ({
    ...doc,
    templateContext: makeRelativeContext(doc.templateContext, computeRootPrefix(doc.relativePath)) as TemplateContext,
  }));
  const composedDocs = await composeDocuments(relativizedDocs, ctx, composeCache, registry);
  const writtenDocs = await writeDocuments(composedDocs, ctx);
  log(`Escritos ${writtenDocs.length} archivos en ${ctx.outputDir}`);

  // afterBuild: notifica a los plugins con las rutas de salida.
  // Las fuentes copiadas desde node_modules se omiten porque buildAssets no retorna su lista.
  if (hasPlugins) {
    const docOutputPaths = writtenDocs.map((doc) => doc.relativePath.replace(/\.md$/, '.html'));
    const assetPaths: string[] = ['css/styles.css'];
    if (ctx.siteConfig.logo?.trim()) assetPaths.push(ctx.siteConfig.logo.trim());
    await registry.runAfterBuild({ outputDir: ctx.outputDir, outputPaths: [...assetPaths, ...docOutputPaths] });
  }

  // Podar entradas obsoletas del scope 'render' usando las claves de todos los
  // documentos procesados en esta ejecución. Se hace al final para no eliminar
  // entradas que aún no han sido escritas por los batches posteriores.
  if (renderCache) {
    const allRenderKeys = new Set(allRenderedDocs.map((doc) => hash(doc.sourceHash, renderCache.cliVersion, renderCache.pandocVersion)));
    await renderCache.manager.prune('render', allRenderKeys);
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada público
// ---------------------------------------------------------------------------

export async function build(cwd: string, options: BuildOptions = {}): Promise<void> {
  // --dry-run: solo descubrir y clasificar; mostrar resumen sin generar salida.
  if (options.dryRun) {
    const dryConfig = await loadSiteConfig(cwd);
    const sourceDocs = await discover(cwd);
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

  const { ctx, renderCache, composeCache, registry, hasPlugins } = await setupBuildEnvironment(cwd, options, log);
  const allDocs = await runDiscovery(cwd, ctx, log);
  const enrichedSiteCtx = buildEnrichedSiteContext(ctx, allDocs);
  const { renderedFileDocs, renderedAuthorDocs, renderedEventDocs, authorDocumentIndex } = await runPrimaryRender(
    allDocs,
    ctx,
    renderCache,
    registry,
  );
  const { finalSiteCtx, renderedBlockDocs } = await runBlocksPrestep(
    allDocs,
    ctx,
    renderCache,
    registry,
    enrichedSiteCtx,
    renderedFileDocs,
    renderedAuthorDocs,
    renderedEventDocs,
    authorDocumentIndex,
  );
  const { allContextDocs, allRenderedDocs } = await runContextPhase(
    allDocs,
    ctx,
    renderCache,
    registry,
    finalSiteCtx,
    renderedFileDocs,
    renderedAuthorDocs,
    renderedEventDocs,
    renderedBlockDocs,
    authorDocumentIndex,
  );
  await runFinalization(allContextDocs, allRenderedDocs, ctx, composeCache, renderCache, registry, hasPlugins, log);
}
