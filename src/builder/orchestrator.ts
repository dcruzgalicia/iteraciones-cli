import { join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { clean } from '../output/writer.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import { buildAssets } from './assets.js';
import { collectByType } from './collect.js';
import { buildSiteContext } from './context/site.js';
import { classifyDocuments } from './pipeline/classify.js';
import { composeDocuments } from './pipeline/compose.js';
import { buildAuthorPipelineContext, buildAuthorsPipelineContext } from './pipeline/context/authors.js';
import { buildCollectionPipelineContext } from './pipeline/context/collection.js';
import { buildEventPipelineContext, buildEventsPipelineContext } from './pipeline/context/event.js';
import { buildContext } from './pipeline/context/index.js';
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

  // Documentos tipo 'file': renderizado Pandoc + contexto de documento.
  const fileDocs = allDocs.filter((doc) => doc.type === 'file');
  const renderedFileDocs = await renderDocuments(fileDocs, ctx.concurrency ?? 4);
  const contextFileDocs = renderedFileDocs.map((doc) => ({ ...doc, templateContext: buildContext(doc, siteCtx) }));

  // Documentos tipo 'collection': renderizado opcional del cuerpo MD + contexto de colección.
  const collectionDocs = allDocs.filter((doc) => doc.type === 'collection');
  const renderedCollectionDocs = await renderDocuments(collectionDocs, ctx.concurrency ?? 4);
  const contextCollectionDocs = renderedCollectionDocs.map((doc) => ({
    ...doc,
    templateContext: buildCollectionPipelineContext(doc, siteCtx, index),
  }));

  // Documentos tipo 'author': renderizado de bio + contexto de autor (publicaciones).
  // Usa renderedFileDocs completos (sin límite de listItemsLimit) para no truncar
  // las publicaciones del autor si hay más docs que el top-N global.
  const authorDocs = allDocs.filter((doc) => doc.type === 'author');
  const renderedAuthorDocs = await renderDocuments(authorDocs, ctx.concurrency ?? 4);
  const contextAuthorDocs = renderedAuthorDocs.map((doc) => ({
    ...doc,
    templateContext: buildAuthorPipelineContext(doc, siteCtx, renderedFileDocs),
  }));

  // Documentos tipo 'authors': renderizado opcional + contexto de índice de autores.
  // Usa renderedAuthorDocs para que htmlFragment (bio) esté disponible en el listado.
  const authorsDocs = allDocs.filter((doc) => doc.type === 'authors');
  const renderedAuthorsDocs = await renderDocuments(authorsDocs, ctx.concurrency ?? 4);
  const contextAuthorsDocs = renderedAuthorsDocs.map((doc) => ({
    ...doc,
    templateContext: buildAuthorsPipelineContext(doc, siteCtx, renderedAuthorDocs),
  }));

  // Documentos tipo 'event': renderizado del cuerpo MD + contexto de evento individual.
  // Los speakers provienen del frontmatter, no de otros documentos.
  const eventDocs = allDocs.filter((doc) => doc.type === 'event');
  const renderedEventDocs = await renderDocuments(eventDocs, ctx.concurrency ?? 4);
  const contextEventDocs = renderedEventDocs.map((doc) => ({
    ...doc,
    templateContext: buildEventPipelineContext(doc, siteCtx),
  }));

  // Documentos tipo 'events': renderizado opcional + contexto de índice de eventos.
  // Usa renderedEventDocs para exponer date, time, location, modality de cada evento.
  const eventsDocs = allDocs.filter((doc) => doc.type === 'events');
  const renderedEventsDocs = await renderDocuments(eventsDocs, ctx.concurrency ?? 4);
  const contextEventsDocs = renderedEventsDocs.map((doc) => ({
    ...doc,
    templateContext: buildEventsPipelineContext(doc, siteCtx, renderedEventDocs),
  }));

  // Documentos tipo 'menu': renderizado opcional del cuerpo MD + contexto de navegación.
  // Los items provienen del frontmatter.nav del propio documento.
  const menuDocs = allDocs.filter((doc) => doc.type === 'menu');
  const renderedMenuDocs = await renderDocuments(menuDocs, ctx.concurrency ?? 4);
  const contextMenuDocs = renderedMenuDocs.map((doc) => ({
    ...doc,
    templateContext: buildMenuPipelineContext(doc, siteCtx),
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
    ],
    ctx,
  );
  await writeDocuments(composedDocs, ctx);
}
