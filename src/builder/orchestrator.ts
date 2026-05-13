import { join } from 'node:path';
import { loadSiteConfig } from '../config/config-loader.js';
import { checkPandoc } from '../services/pandoc-runner.js';
import { buildSiteContext } from './context/site.js';
import { classifyDocuments } from './pipeline/classify.js';
import { composeDocuments } from './pipeline/compose.js';
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

  const siteCtx = buildSiteContext(siteConfig, ctx.cssPath);

  // MVP: solo documentos de tipo 'file'. Sin caché ni plugins.
  const sourceDocs = await discover(cwd);
  const allDocs = classifyDocuments(sourceDocs);
  const fileDocs = allDocs.filter((doc) => doc.type === 'file');
  const renderedDocs = await renderDocuments(fileDocs, ctx.concurrency ?? 4);
  const contextDocs = renderedDocs.map((doc) => ({ ...doc, templateContext: buildContext(doc, siteCtx) }));
  const composedDocs = await composeDocuments(contextDocs, ctx);
  await writeDocuments(composedDocs, ctx);
}
