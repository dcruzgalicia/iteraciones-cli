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
import { collectByType } from './collect.js';
import { buildRelatedAuthorsContext, createAuthorDocumentIndex } from './context/authors.js';
import { buildSiteContext } from './context/site.js';
import { classifyDocuments } from './pipeline/classify.js';
import { type ComposeCache, composeDocuments, renderBlocksToRegions } from './pipeline/compose.js';
import { buildAuthorPipelineContext, buildAuthorsPipelineContext } from './pipeline/context/authors.js';
import { buildCardPipelineContext } from './pipeline/context/card.js';
import { buildCollectionPipelineContext } from './pipeline/context/collection.js';
import { buildEventPipelineContext, buildEventsPipelineContext } from './pipeline/context/event.js';
import { buildContext } from './pipeline/context/index.js';
import { buildListPipelineContext } from './pipeline/context/list.js';
import { buildMenuPipelineContext } from './pipeline/context/menu.js';
import { mergeContexts } from './pipeline/context/merge.js';
import { discover } from './pipeline/discover.js';
import { renderDocuments } from './pipeline/render.js';
import { writeDocuments } from './pipeline/write.js';
import type { AuthorDocumentIndex, BuildContext, DocumentType } from './types.js';

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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildBlockTypeContext(
  doc: Parameters<typeof buildContext>[0],
  siteCtx: TemplateContext,
  index: Map<DocumentType, Parameters<typeof buildCollectionPipelineContext>[0][]>,
  renderedFileDocs: Parameters<typeof buildAuthorPipelineContext>[2],
  renderedAuthorDocs: Parameters<typeof buildAuthorsPipelineContext>[2],
  renderedEventDocs: Parameters<typeof buildEventsPipelineContext>[2],
  authorDocumentIndex: AuthorDocumentIndex,
): TemplateContext {
  switch (doc.type) {
    case 'collection':
      return buildCollectionPipelineContext(doc, siteCtx, index, authorDocumentIndex);
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
    case 'file':
    default:
      return mergeContexts(buildContext(doc, siteCtx, authorDocumentIndex), buildRelatedAuthorsContext(doc, authorDocumentIndex));
  }
}

export async function build(cwd: string, options: BuildOptions = {}): Promise<void> {
  // --dry-run: solo descubrir y clasificar; mostrar resumen sin generar salida.
  if (options.dryRun) {
    const siteConfig = await loadSiteConfig(cwd);
    const sourceDocs = await discover(cwd);
    const allDocs = classifyDocuments(sourceDocs);
    const counts = new Map<string, number>();
    for (const doc of allDocs) {
      const type = doc.type ?? 'unknown';
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    process.stdout.write(`[dry-run] Se procesar\u00edan ${allDocs.length} documentos:\n`);
    for (const [type, count] of [...counts.entries()].sort()) {
      process.stdout.write(`  ${type.padEnd(12)}: ${count}\n`);
    }
    return;
  }

  const log = options.verbose ? (msg: string) => process.stdout.write(`${msg}\n`) : (_msg: string) => undefined;

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

  // Limpia outputDir y genera CSS/assets antes de construir el contexto del sitio.
  await clean(ctx.outputDir);
  ctx.cssPath = await buildAssets(ctx.outputDir, ctx.cwd, siteConfig, { noTailwind: options.noTailwind });
  log(`Assets generados en ${ctx.outputDir}`);
  const siteCtx = buildSiteContext(siteConfig, ctx.cssPath);

  const pkg = (await Bun.file(join(import.meta.dir, '../../package.json')).json()) as { version: string };
  const cacheManager = new CacheManager(cwd);
  // El fingerprint invalida la caché cuando cambia el conjunto de plugins declarados en
  // _iteraciones.yaml. Nota: no detecta cambios en el código fuente de un plugin si su
  // ruta no cambia; en ese caso se debe limpiar la caché manualmente.
  const pluginFingerprint = siteConfig.plugins.length > 0 ? hash(JSON.stringify(siteConfig.plugins)) : undefined;
  // --no-cache: omitir caché completamente (renderDocuments/composeDocuments aceptan undefined).
  const renderCache = options.noCache ? undefined : { manager: cacheManager, cliVersion: pkg.version, pandocVersion, pluginFingerprint };
  const composeCache: ComposeCache | undefined = options.noCache ? undefined : { manager: cacheManager, cliVersion: pkg.version, pluginFingerprint };

  const sourceDocs = await discover(cwd);
  log(`Descubiertos ${sourceDocs.length} documentos`);
  const allDocs = classifyDocuments(sourceDocs);
  const index = collectByType(
    allDocs.filter((doc) => doc.kind !== 'block'),
    siteConfig,
  );

  // Detectar el documento primario de menú para inyectar menuHref/menuTitle en
  // el siteCtx compartido por todas las páginas. Debe hacerse antes de construir
  // cualquier templateContext para que el botón de menú aparezca en el layout.
  const primaryMenuDoc = allDocs.find((doc) => doc.type === 'menu' && doc.kind !== 'block');
  const enrichedSiteCtx = primaryMenuDoc
    ? {
        ...siteCtx,
        menuHref: `/${primaryMenuDoc.relativePath.replace(/\.md$/, '.html')}`,
        menuTitle: escapeHtml(primaryMenuDoc.frontmatter.title || 'Menú'),
      }
    : siteCtx;

  // Renderizado Pandoc previo de los tipos que los bloques pueden necesitar como datos
  // relacionados (file, author, event). Se hace antes del pre-paso de bloques para que
  // buildBlockTypeContext reciba datos reales en lugar de arrays vacíos.
  const fileDocs = allDocs.filter((doc) => doc.type === 'file' && doc.kind !== 'block');
  const renderedFileDocs = await renderDocuments(fileDocs, ctx.concurrency ?? 4, renderCache, registry);

  const authorDocs = allDocs.filter((doc) => doc.type === 'author' && doc.kind !== 'block');
  const renderedAuthorDocs = await renderDocuments(authorDocs, ctx.concurrency ?? 4, renderCache, registry);

  // Índice de autores por título normalizado (lowercase). Se construye aquí para que
  // esté disponible antes del pre-paso de bloques y del paso de contexto de páginas.
  const authorDocumentIndex = createAuthorDocumentIndex(renderedAuthorDocs);

  const eventDocs = allDocs.filter((doc) => doc.type === 'event' && doc.kind !== 'block');
  const renderedEventDocs = await renderDocuments(eventDocs, ctx.concurrency ?? 4, renderCache, registry);

  // Pre-paso de bloques: renderizar todos los docs con kind === 'block', construir
  // sus contextos de tipo con los datos reales de página, aplicar sus templates
  // para obtener innerHtml y agrupar por región. El resultado se inyecta en
  // finalSiteCtx para que los region slots del layout se rellenen en todas las páginas.
  // Los bloques NO generan su propio archivo HTML de salida.
  const allBlockDocs = allDocs.filter((doc) => doc.kind === 'block');
  const renderedBlockDocs = await renderDocuments(allBlockDocs, ctx.concurrency ?? 4, renderCache, registry);
  const contextBlockDocs = renderedBlockDocs.map((doc) => ({
    ...doc,
    templateContext: buildBlockTypeContext(doc, enrichedSiteCtx, index, renderedFileDocs, renderedAuthorDocs, renderedEventDocs, authorDocumentIndex),
  }));
  const regionBlocks = await renderBlocksToRegions(contextBlockDocs);
  const finalSiteCtx: TemplateContext = { ...enrichedSiteCtx, ...regionBlocks };

  // Contextos para los docs ya renderizados (file). Se fusionan con buildRelatedAuthorsContext
  // para que el slot `authors` del sidebar-primary se rellene si el doc tiene autor(es)
  // con documentos de tipo 'author' en el sitio.
  const contextFileDocs = renderedFileDocs.map((doc) => ({
    ...doc,
    templateContext: mergeContexts(buildContext(doc, finalSiteCtx, authorDocumentIndex), buildRelatedAuthorsContext(doc, authorDocumentIndex)),
  }));

  // Documentos tipo 'collection': renderizado opcional del cuerpo MD + contexto de colección.
  const collectionDocs = allDocs.filter((doc) => doc.type === 'collection' && doc.kind !== 'block');
  const renderedCollectionDocs = await renderDocuments(collectionDocs, ctx.concurrency ?? 4, renderCache, registry);
  const contextCollectionDocs = renderedCollectionDocs.map((doc) => ({
    ...doc,
    templateContext: buildCollectionPipelineContext(doc, finalSiteCtx, index, authorDocumentIndex),
  }));

  // Documentos tipo 'author': contexto de autor (bio + publicaciones relacionadas).
  // Usa renderedFileDocs completos (sin límite de listItemsLimit) para no truncar
  // las publicaciones del autor si hay más docs que el top-N global.
  const contextAuthorDocs = renderedAuthorDocs.map((doc) => ({
    ...doc,
    templateContext: buildAuthorPipelineContext(doc, finalSiteCtx, renderedFileDocs),
  }));

  // Documentos tipo 'authors': renderizado opcional + contexto de índice de autores.
  // Usa renderedAuthorDocs para que htmlFragment (bio) esté disponible en el listado.
  const authorsDocs = allDocs.filter((doc) => doc.type === 'authors' && doc.kind !== 'block');
  const renderedAuthorsDocs = await renderDocuments(authorsDocs, ctx.concurrency ?? 4, renderCache, registry);
  const contextAuthorsDocs = renderedAuthorsDocs.map((doc) => ({
    ...doc,
    templateContext: buildAuthorsPipelineContext(doc, finalSiteCtx, renderedAuthorDocs),
  }));

  // Documentos tipo 'event': contexto de evento individual.
  // Los speakers se resuelven desde authorDocumentIndex para enriquecer con href y body.
  const contextEventDocs = renderedEventDocs.map((doc) => ({
    ...doc,
    templateContext: buildEventPipelineContext(doc, finalSiteCtx, authorDocumentIndex),
  }));

  // Documentos tipo 'events': renderizado opcional + contexto de índice de eventos.
  // Usa renderedEventDocs para exponer date, time, location, modality de cada evento.
  const eventsDocs = allDocs.filter((doc) => doc.type === 'events' && doc.kind !== 'block');
  const renderedEventsDocs = await renderDocuments(eventsDocs, ctx.concurrency ?? 4, renderCache, registry);
  const contextEventsDocs = renderedEventsDocs.map((doc) => ({
    ...doc,
    templateContext: buildEventsPipelineContext(doc, finalSiteCtx, renderedEventDocs),
  }));

  // Documentos tipo 'menu': renderizado opcional del cuerpo MD + contexto de navegación.
  // Los items provienen del frontmatter.nav del propio documento.
  const menuDocs = allDocs.filter((doc) => doc.type === 'menu' && doc.kind !== 'block');
  const renderedMenuDocs = await renderDocuments(menuDocs, ctx.concurrency ?? 4, renderCache, registry);
  const contextMenuDocs = renderedMenuDocs.map((doc) => ({
    ...doc,
    templateContext: buildMenuPipelineContext(doc, finalSiteCtx),
  }));

  // Documentos tipo 'card': solo se procesan los de kind 'page' (los bloques ya
  // se procesaron en el pre-paso de bloques y no generan archivos de salida propios).
  const cardDocs = allDocs.filter((doc) => doc.type === 'card' && doc.kind !== 'block');
  const renderedCardDocs = await renderDocuments(cardDocs, ctx.concurrency ?? 4, renderCache, registry);
  const contextCardDocs = renderedCardDocs.map((doc) => ({
    ...doc,
    templateContext: buildCardPipelineContext(doc, finalSiteCtx),
  }));

  // Documentos tipo 'list': renderizado opcional del cuerpo MD + contexto de lista automática.
  // Usa renderedFileDocs para que htmlFragment esté disponible en cada item del listado.
  const listDocs = allDocs.filter((doc) => doc.type === 'list' && doc.kind !== 'block');
  const renderedListDocs = await renderDocuments(listDocs, ctx.concurrency ?? 4, renderCache, registry);
  const contextListDocs = renderedListDocs.map((doc) => ({
    ...doc,
    templateContext: buildListPipelineContext(doc, finalSiteCtx, renderedFileDocs, authorDocumentIndex),
  }));

  const composedDocs = await composeDocuments(
    [
      ...contextFileDocs,
      ...contextCollectionDocs,
      ...contextAuthorDocs,
      ...contextAuthorsDocs,
      ...contextEventDocs,
      ...contextEventsDocs,
      ...contextMenuDocs,
      ...contextCardDocs,
      ...contextListDocs,
    ],
    ctx,
    composeCache,
    registry,
  );
  const writtenDocs = await writeDocuments(composedDocs, ctx);
  log(`Escritos ${writtenDocs.length} archivos en ${ctx.outputDir}`);

  // afterBuild: notifica a los plugins que el build finalizó con las rutas de salida.
  // Se incluyen los assets conocidos (CSS y logo si está configurado). Las fuentes
  // copiadas desde node_modules se omiten porque buildAssets no retorna su lista.
  if (plugins.length > 0) {
    const docOutputPaths = writtenDocs.map((doc) => doc.relativePath.replace(/\.md$/, '.html'));
    const assetPaths: string[] = ['css/styles.css'];
    if (siteConfig.logo?.trim()) assetPaths.push(siteConfig.logo.trim());
    await registry.runAfterBuild({ outputDir: ctx.outputDir, outputPaths: [...assetPaths, ...docOutputPaths] });
  }

  // Podar entradas obsoletas del scope 'render' usando las claves de todos los
  // documentos procesados en esta ejecución. Se hace al final para no eliminar
  // entradas que aún no han sido escritas por los batches posteriores.
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
  if (renderCache) {
    const allRenderKeys = new Set(allRenderedDocs.map((doc) => hash(doc.sourceHash, renderCache.cliVersion, renderCache.pandocVersion)));
    await renderCache.manager.prune('render', allRenderKeys);
  }
}
