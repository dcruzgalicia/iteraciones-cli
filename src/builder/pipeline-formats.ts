import { basename, dirname, join } from 'node:path';

import { formatHumanDate } from '../lib/date.js';
import { fmStringList, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { htmlSlugFor } from './discover.js';
import { assembleExportDocument } from './export/assemble.js';
import { convertToEpub, convertToMarkdown } from './export/runner.js';
import { buildTexDistribution, markdownToLatex, rewriteTexForDist } from './latex-composer.js';
import { primaryOutputExtension } from './output-layout.js';
import { formatLinksFor, parseFileFrontmatter, readMarkdownOrWarn, relativeHref, writeOutput } from './pipeline-io.js';
import type { ExportContext, FormatWorkSets, RenderContext } from './pipeline-setup.js';
import { htmlPageFromMarkdown } from './render.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';
import type { PdfXmpMetadata } from './xmpdata.js';
import { injectXmpMetadataIntoLatex } from './xmpdata.js';

interface DocumentOutputs {
  slug: string;
  outSlug: string;
  dir: string;
  fm: Record<string, unknown>;
  content: string;
  outBase(name: string): string;
}

function xmpMetadataFor(
  fm: Record<string, unknown>,
  lang: string,
  formatCfg: Record<string, unknown> | undefined,
  rootCfg: Record<string, unknown>,
): PdfXmpMetadata {
  return {
    title: resolveStringField(fm, formatCfg, rootCfg, 'title'),
    authors: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'creator')),
    lang,
    dateIso: resolveStringField(fm, formatCfg, rootCfg, 'date'),
    subject: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'subject'))?.join(', '),
    publishers: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'publisher')),
    keywords: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'keywords')),
    description: resolveStringField(fm, formatCfg, rootCfg, 'description'),
    contributors: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'contributor')),
    identifier: resolveStringField(fm, formatCfg, rootCfg, 'identifier'),
    source: resolveStringField(fm, formatCfg, rootCfg, 'source'),
    relations: fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'relation')),
    coverage: resolveStringField(fm, formatCfg, rootCfg, 'coverage'),
    rights: resolveStringField(fm, formatCfg, rootCfg, 'rights'),
    license: resolveStringField(fm, formatCfg, rootCfg, 'license'),
    doi: resolveStringField(fm, formatCfg, rootCfg, 'doi'),
    isbn: resolveStringField(fm, formatCfg, rootCfg, 'isbn'),
    abstract: resolveStringField(fm, formatCfg, rootCfg, 'abstract'),
  };
}

async function emitLatexAndQueuePdf(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  sets: FormatWorkSets,
): Promise<void> {
  const { ctx, lang, warnedLangs, formatCfg, plan } = renderCtx;
  const latexOn = plan.activeFormats.latex;
  const pdfOn = plan.activeFormats.pdf;
  const { dir, outBase, outSlug, fm } = outputs;
  const texDistPath = outBase(`${outSlug}${primaryOutputExtension('latex')}`);

  const { tex: fullTex, processedImages } = await markdownToLatex(outputs.content, doc, {
    filters: exportCtx.filters,
    bibFiles: exportCtx.bibFiles,
    templatePath: doc.frontmatter.type === 'collection' ? exportCtx.latexCollectionTemplatePath : exportCtx.latexTemplatePath,
    fm,
    siteConfig: ctx.siteConfig,
    biblatexAvailable: exportCtx.biblatexAvailable,
    warnedLangs,
    pageDimensions: renderCtx.pageDimensions,
    cropActive: renderCtx.cropActive,
    pdfxActive: renderCtx.pdfxActive,
  });
  const texWithXmp = renderCtx.pdfxActive ? injectXmpMetadataIntoLatex(fullTex, xmpMetadataFor(fm, lang, formatCfg?.pdf, ctx.siteConfig)) : fullTex;

  if (latexOn) {
    const distribution = buildTexDistribution(processedImages, outSlug);
    await Promise.all(
      [...distribution].map(async ([absSrc, fileName]) => {
        if (await Bun.file(absSrc).exists()) await Bun.write(outBase(fileName), Bun.file(absSrc));
      }),
    );
    await writeOutput(texDistPath, rewriteTexForDist(texWithXmp, distribution));
  }

  if (pdfOn) {
    const texPath = join(exportCtx.pdfWorkDir, dir, `${outSlug}${primaryOutputExtension('latex')}`);
    await writeOutput(texPath, texWithXmp);
    sets.pdfJobs.push({
      dir,
      slug: outSlug,
      relativePath: doc.relativePath,
      texPath,
      pdfDest: outBase(`${outSlug}${primaryOutputExtension('pdf')}`),
    });
  }
}

async function emitHtmlPage(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan, formatCfg, lang, logoInline } = renderCtx;
  const htmlConfig = formatCfg?.html;
  const { dir, outBase, outSlug, slug, fm, content } = outputs;
  const cwd = ctx.cwd;

  const formats = formatLinksFor(plan, dir, outSlug);
  const hasHomePage = discoveryIndex.has('index.md');
  const html = await htmlPageFromMarkdown(content, doc, {
    cwd,
    vars: {
      title: doc.frontmatter.title || slug,
      siteTitle: htmlConfig?.site?.title ?? 'iteraciones',
      tagline: htmlConfig?.site?.description ?? 'escribir, compartir, re-existir',
      lang,
      theme: htmlConfig?.site?.theme,
      accent: htmlConfig?.site?.color,
      css: ctx.needsCss ? relativeHref(dir, 'css/styles.css') : undefined,
      authorMeta: doc.frontmatter.creator.join(', '),
      logoInline,
      docTitle: doc.frontmatter.title && doc.frontmatter.title !== 'Sin título' ? doc.frontmatter.title : undefined,
      subtitle: doc.frontmatter.subtitle,
      date: formatHumanDate(doc.frontmatter.date),
      homeHref: hasHomePage ? relativeHref(dir, 'index.html') : undefined,
      formats: formats.length > 0 ? formats : undefined,
    },
    siteConfig: ctx.siteConfig,
    templatePath: exportCtx.htmlTemplatePath,
    refsCardTemplate: exportCtx.refsCardTemplate,
    fm,
    bibOptions: exportCtx.bibOptions,
    luaFilters: exportCtx.filters,
  });
  await writeOutput(outBase(`${outSlug}${primaryOutputExtension('html')}`), html);
}

async function readCollectionFiles(
  doc: BuildDocument,
  cwd: string,
): Promise<{ creator: string[]; title: string; subtitle: string | undefined; body: string }[]> {
  const files = doc.frontmatter.files;
  if (!files || files.length === 0) return [];

  const entries: { creator: string[]; title: string; subtitle: string | undefined; body: string }[] = [];
  for (const file of files) {
    const filePath = join(cwd, file);
    let text: string;
    try {
      text = await Bun.file(filePath).text();
    } catch {
      logWarning(`collection "${doc.relativePath}": no se pudo leer "${file}"`, 'build');
      continue;
    }
    const parsed = parseFileFrontmatter(text);
    if (parsed.body.trim()) entries.push(parsed);
  }
  return entries;
}

function buildCollectionSectionsLatex(entries: { creator: string[]; title: string; subtitle: string | undefined; body: string }[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    const creator = e.creator.length > 0 ? e.creator.join(', ') : 'Anónima';
    const title = e.title || 'Sin título';
    parts.push(`\\chapter{${creator}}`);
    parts.push(`\\section{${title}}`);
    if (e.subtitle) parts.push(`\\subsection{${e.subtitle}}`);
    parts.push(e.body.trim());
  }
  return parts.join('\n\n');
}

function buildCollectionSectionsHtml(entries: { creator: string[]; title: string; subtitle: string | undefined; body: string }[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    const creator = e.creator.length > 0 ? e.creator.join(', ') : 'Anónima';
    const title = e.title || 'Sin título';
    parts.push(`<h2>${creator}</h2>`);
    parts.push(`<h3>${title}</h3>`);
    if (e.subtitle) parts.push(`<h4>${e.subtitle}</h4>`);
    parts.push(e.body.trim());
  }
  return parts.join('\n\n');
}

function buildCollectionSectionsMarkdown(entries: { creator: string[]; title: string; subtitle: string | undefined; body: string }[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    const creator = e.creator.length > 0 ? e.creator.join(', ') : 'Anónima';
    const title = e.title || 'Sin título';
    parts.push(`## ${creator}`);
    parts.push(`### ${title}`);
    if (e.subtitle) parts.push(`#### ${e.subtitle}`);
    parts.push(e.body.trim());
  }
  return parts.join('\n\n');
}

function resolveCollectionContent(
  collectionEntries: { creator: string[]; title: string; subtitle: string | undefined; body: string }[],
  format: 'latex' | 'html' | 'markdown',
  fallback: string,
): string {
  if (collectionEntries.length === 0) return fallback;
  if (format === 'latex') return buildCollectionSectionsLatex(collectionEntries);
  if (format === 'html') return buildCollectionSectionsHtml(collectionEntries);
  return buildCollectionSectionsMarkdown(collectionEntries);
}

function buildOutputs(
  entry: DiscoveryEntry | undefined,
  slug: string,
  outSlug: string,
  dir: string,
  content: string,
  outputDir: string,
): DocumentOutputs {
  return {
    slug,
    outSlug,
    dir,
    fm: entry?.fm ?? {},
    content,
    outBase: (name: string): string => join(outputDir, dir === '.' ? '' : dir, name),
  };
}

async function emitCollectionFormats(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  collectionEntries: { creator: string[]; title: string; subtitle: string | undefined; body: string }[],
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  formatWorkSets: FormatWorkSets,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan } = renderCtx;
  const { activeFormats } = plan;
  const content = outputs.content;

  if ((activeFormats.latex || activeFormats.pdf) && formatWorkSets.latexPaths.has(doc.relativePath)) {
    const latexOutputs =
      collectionEntries.length > 0 ? { ...outputs, content: resolveCollectionContent(collectionEntries, 'latex', content) } : outputs;
    await emitLatexAndQueuePdf(doc, latexOutputs, renderCtx, exportCtx, formatWorkSets);
  }

  const exportDoc = assembleExportDocument(doc, renderCtx.lang, exportCtx.globalBibliography, exportCtx.globalCsl, ctx.siteConfig.toc);

  if (activeFormats.html && formatWorkSets.htmlPaths.has(doc.relativePath)) {
    const htmlOutputs =
      collectionEntries.length > 0 ? { ...outputs, content: resolveCollectionContent(collectionEntries, 'html', content) } : outputs;
    await emitHtmlPage(doc, htmlOutputs, renderCtx, exportCtx, discoveryIndex);
  }

  if (activeFormats.epub && formatWorkSets.epubPaths.has(doc.relativePath)) {
    await convertToEpub(
      resolveCollectionContent(collectionEntries, 'html', content),
      outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('epub')}`),
      exportDoc,
      exportCtx.filters,
      ctx.siteConfig.toc,
      outputs.fm,
    );
  }
  if (activeFormats.markdown && formatWorkSets.mdPaths.has(doc.relativePath)) {
    await convertToMarkdown(
      resolveCollectionContent(collectionEntries, 'markdown', content),
      outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('markdown')}`),
      exportDoc,
      exportCtx.filters,
      ctx.cwd,
      outputs.fm,
    );
  }
}

export async function processDocumentFormats(
  doc: BuildDocument,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  formatWorkSets: FormatWorkSets,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx } = renderCtx;

  const content = await readMarkdownOrWarn(doc);
  if (content === null) return;

  const entry = discoveryIndex.get(doc.relativePath);
  const slug = doc.slug ?? basename(doc.relativePath, '.md');
  const outSlug = htmlSlugFor(doc.relativePath, slug);
  const dir = dirname(doc.relativePath);

  const isCollection = doc.frontmatter.type === 'collection';
  const collectionEntries = isCollection ? await readCollectionFiles(doc, ctx.cwd) : [];
  if (isCollection && collectionEntries.length === 0) {
    logWarning(`"${doc.relativePath}": collection sin contenido en files; se omite del build`, 'build');
    return;
  }

  const outputs = buildOutputs(entry, slug, outSlug, dir, content, ctx.outputDir);

  await emitCollectionFormats(doc, outputs, collectionEntries, renderCtx, exportCtx, formatWorkSets, discoveryIndex);
}
