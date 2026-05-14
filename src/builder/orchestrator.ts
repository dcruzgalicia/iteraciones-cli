import { join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { clean } from '../output/writer.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import type { TemplateContext } from '../template/render/context.js';
import { buildAssets } from './assets.js';
import { collectByType } from './collect.js';
import { buildSiteContext } from './context/site.js';
import { classifyDocuments } from './pipeline/classify.js';
import { composeDocuments, renderBlocksToRegions } from './pipeline/compose.js';
import { buildAuthorPipelineContext, buildAuthorsPipelineContext } from './pipeline/context/authors.js';
import { buildCardPipelineContext } from './pipeline/context/card.js';
import { buildCollectionPipelineContext } from './pipeline/context/collection.js';
import { buildEventPipelineContext, buildEventsPipelineContext } from './pipeline/context/event.js';
import { buildContext } from './pipeline/context/index.js';
import { buildListPipelineContext } from './pipeline/context/list.js';
import { buildMenuPipelineContext } from './pipeline/context/menu.js';
import { discover } from './pipeline/discover.js';
import { renderDocuments } from './pipeline/render.js';
import { writeDocuments } from './pipeline/write.js';
import type { BuildContext } from './types.js';

export interface BuildOptions {
  outputDir?: string;
  cssPath?: string;
  concurrency?: number;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildBlockTypeContext(doc: Parameters<typeof buildContext>[0], siteCtx: TemplateContext): TemplateContext {
  switch (doc.type) {
    case 'collection':
      return buildCollectionPipelineContext(doc, siteCtx, new Map());
    case 'author':
      return buildAuthorPipelineContext(doc, siteCtx, []);
    case 'authors':
      return buildAuthorsPipelineContext(doc, siteCtx, []);
    case 'event':
      return buildEventPipelineContext(doc, siteCtx);
    case 'events':
      return buildEventsPipelineContext(doc, siteCtx, []);
    case 'menu':
      return buildMenuPipelineContext(doc, siteCtx);
    case 'card':
      return buildCardPipelineContext(doc, siteCtx);
    case 'list':
      return buildListPipelineContext(doc, siteCtx, []);
    case 'file':
    default:
      return buildContext(doc, siteCtx);
  }
}

export async function build(cwd: string, options: BuildOptions = {}): Promise<void> {
  await checkPandoc();
  const siteConfig = await loadSiteConfig(cwd);

  const ctx: BuildContext = {
    siteConfig,
    cwd,
    outputDir: options.outputDir ?? join(cwd, 'dist/web'),
    cssPath: options.cssPath ?? '',
    concurrency: options.concurrency ?? 4,
  };

  // Limpia outputDir y genera CSS/assets antes de construir el contexto del sitio.
  await clean(ctx.outputDir);
  ctx.cssPath = await buildAssets(ctx.outputDir, ctx.cwd, siteConfig);
  const siteCtx = buildSiteContext(siteConfig, ctx.cssPath);

  // MVP: sin caché ni plugins.
  const sourceDocs = await discover(cwd);
  const allDocs = classifyDocuments(sourceDocs);
  const index = collectByType(allDocs, siteConfig);

  // Detectar el documento primario de menú para inyectar menuHref/menuTitle en
  // el siteCtx compartido por todas las páginas. Debe hacerse antes de construir
  // cualquier templateContext para que el botón de menú aparezca en el layout.
  const primaryMenuDoc = allDocs.find((doc) => doc.type === 'menu');
  const enrichedSiteCtx = primaryMenuDoc
    ? {
        ...siteCtx,
        menuHref: primaryMenuDoc.relativePath.replace(/\.md$/, '.html'),
        menuTitle: escapeHtml(primaryMenuDoc.frontmatter.title || 'Menú'),
      }
    : siteCtx;

  // Pre-paso de bloques: renderizar todos los docs con kind === 'block', construir
  // sus contextos de tipo, aplicar sus templates para obtener innerHtml y agrupar
  // por región. El resultado se inyecta en finalSiteCtx para que los region slots
  // del layout ($content-before$, $footer-left$, etc.) se rellenen en todas las
  // páginas. Los bloques NO generan su propio archivo HTML de salida.
  const allBlockDocs = allDocs.filter((doc) => doc.kind === 'block');
  const renderedBlockDocs = await renderDocuments(allBlockDocs, ctx.concurrency ?? 4);
  const contextBlockDocs = renderedBlockDocs.map((doc) => ({
    ...doc,
    templateContext: buildBlockTypeContext(doc, enrichedSiteCtx),
  }));
  const regionBlocks = await renderBlocksToRegions(contextBlockDocs);
  const finalSiteCtx: TemplateContext = { ...enrichedSiteCtx, ...regionBlocks };

  // Documentos tipo 'file': renderizado Pandoc + contexto de documento.
  // Solo se procesan documentos de tipo 'page' (kind !== 'block').
  const fileDocs = allDocs.filter((doc) => doc.type === 'file' && doc.kind !== 'block');
  const renderedFileDocs = await renderDocuments(fileDocs, ctx.concurrency ?? 4);
  const contextFileDocs = renderedFileDocs.map((doc) => ({ ...doc, templateContext: buildContext(doc, finalSiteCtx) }));

  // Documentos tipo 'collection': renderizado opcional del cuerpo MD + contexto de colección.
  const collectionDocs = allDocs.filter((doc) => doc.type === 'collection' && doc.kind !== 'block');
  const renderedCollectionDocs = await renderDocuments(collectionDocs, ctx.concurrency ?? 4);
  const contextCollectionDocs = renderedCollectionDocs.map((doc) => ({
    ...doc,
    templateContext: buildCollectionPipelineContext(doc, finalSiteCtx, index),
  }));

  // Documentos tipo 'author': renderizado de bio + contexto de autor (publicaciones).
  // Usa renderedFileDocs completos (sin límite de listItemsLimit) para no truncar
  // las publicaciones del autor si hay más docs que el top-N global.
  const authorDocs = allDocs.filter((doc) => doc.type === 'author' && doc.kind !== 'block');
  const renderedAuthorDocs = await renderDocuments(authorDocs, ctx.concurrency ?? 4);
  const contextAuthorDocs = renderedAuthorDocs.map((doc) => ({
    ...doc,
    templateContext: buildAuthorPipelineContext(doc, finalSiteCtx, renderedFileDocs),
  }));

  // Documentos tipo 'authors': renderizado opcional + contexto de índice de autores.
  // Usa renderedAuthorDocs para que htmlFragment (bio) esté disponible en el listado.
  const authorsDocs = allDocs.filter((doc) => doc.type === 'authors' && doc.kind !== 'block');
  const renderedAuthorsDocs = await renderDocuments(authorsDocs, ctx.concurrency ?? 4);
  const contextAuthorsDocs = renderedAuthorsDocs.map((doc) => ({
    ...doc,
    templateContext: buildAuthorsPipelineContext(doc, finalSiteCtx, renderedAuthorDocs),
  }));

  // Documentos tipo 'event': renderizado del cuerpo MD + contexto de evento individual.
  // Los speakers provienen del frontmatter, no de otros documentos.
  const eventDocs = allDocs.filter((doc) => doc.type === 'event' && doc.kind !== 'block');
  const renderedEventDocs = await renderDocuments(eventDocs, ctx.concurrency ?? 4);
  const contextEventDocs = renderedEventDocs.map((doc) => ({
    ...doc,
    templateContext: buildEventPipelineContext(doc, finalSiteCtx),
  }));

  // Documentos tipo 'events': renderizado opcional + contexto de índice de eventos.
  // Usa renderedEventDocs para exponer date, time, location, modality de cada evento.
  const eventsDocs = allDocs.filter((doc) => doc.type === 'events' && doc.kind !== 'block');
  const renderedEventsDocs = await renderDocuments(eventsDocs, ctx.concurrency ?? 4);
  const contextEventsDocs = renderedEventsDocs.map((doc) => ({
    ...doc,
    templateContext: buildEventsPipelineContext(doc, finalSiteCtx, renderedEventDocs),
  }));

  // Documentos tipo 'menu': renderizado opcional del cuerpo MD + contexto de navegación.
  // Los items provienen del frontmatter.nav del propio documento.
  const menuDocs = allDocs.filter((doc) => doc.type === 'menu' && doc.kind !== 'block');
  const renderedMenuDocs = await renderDocuments(menuDocs, ctx.concurrency ?? 4);
  const contextMenuDocs = renderedMenuDocs.map((doc) => ({
    ...doc,
    templateContext: buildMenuPipelineContext(doc, finalSiteCtx),
  }));

  // Documentos tipo 'card': solo se procesan los de kind 'page' (los bloques ya
  // se procesaron en el pre-paso de bloques y no generan archivos de salida propios).
  const cardDocs = allDocs.filter((doc) => doc.type === 'card' && doc.kind !== 'block');
  const renderedCardDocs = await renderDocuments(cardDocs, ctx.concurrency ?? 4);
  const contextCardDocs = renderedCardDocs.map((doc) => ({
    ...doc,
    templateContext: buildCardPipelineContext(doc, finalSiteCtx),
  }));

  // Documentos tipo 'list': renderizado opcional del cuerpo MD + contexto de lista automática.
  // Usa renderedFileDocs para que htmlFragment esté disponible en cada item del listado.
  const listDocs = allDocs.filter((doc) => doc.type === 'list' && doc.kind !== 'block');
  const renderedListDocs = await renderDocuments(listDocs, ctx.concurrency ?? 4);
  const contextListDocs = renderedListDocs.map((doc) => ({
    ...doc,
    templateContext: buildListPipelineContext(doc, finalSiteCtx, renderedFileDocs),
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
  );
  await writeDocuments(composedDocs, ctx);
}
