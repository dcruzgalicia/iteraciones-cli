import { join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { clean } from '../output/writer.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import { buildAssets } from './assets.js';
import { collectByType } from './collect.js';
import { buildSiteContext } from './context/site.js';
import { classifyDocuments } from './pipeline/classify.js';
import { composeDocuments } from './pipeline/compose.js';
import { buildCollectionPipelineContext } from './pipeline/context/collection.js';
import { buildContext } from './pipeline/context/index.js';
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

  const composedDocs = await composeDocuments([...contextFileDocs, ...contextCollectionDocs], ctx);
  await writeDocuments(composedDocs, ctx);
}
