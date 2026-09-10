import { basename, dirname, join } from 'node:path';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, resolveBooleanField, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { execPandoc, MD_READER } from '../lib/pandoc-runner.js';
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
  authorsBlock = '',
): Promise<void> {
  const { ctx, lang, warnedLangs, formatCfg, plan } = renderCtx;
  const latexOn = plan.activeFormats.latex;
  const pdfOn = plan.activeFormats.pdf;
  const { dir, outBase, outSlug, fm } = outputs;
  const texDistPath = outBase(`${outSlug}${primaryOutputExtension('latex')}`);

  const { tex: fullTex, processedImages } = await markdownToLatex(outputs.content, doc, {
    filters: exportCtx.filters,
    bibFiles: exportCtx.bibFiles,
    templatePath:
      doc.frontmatter.type === 'collection'
        ? exportCtx.latexCollectionTemplatePath
        : doc.frontmatter.type === 'creator'
          ? exportCtx.latexCreatorTemplatePath
          : doc.frontmatter.type === 'intervention'
            ? exportCtx.latexInterventionTemplatePath
            : exportCtx.latexTemplatePath,
    fm,
    siteConfig: ctx.siteConfig,
    formatCfg: formatCfg?.pdf,
    biblatexAvailable: exportCtx.biblatexAvailable,
    warnedLangs,
    pageDimensions: renderCtx.pageDimensions,
    cropActive: renderCtx.cropActive,
    pdfxActive: renderCtx.pdfxActive,
    cwd: ctx.cwd,
  });
  const texWithAuthors =
    authorsBlock && fullTex.includes('\\printbibliography')
      ? fullTex.replace('\\printbibliography', `${authorsBlock}\n\n\\printbibliography`)
      : authorsBlock && fullTex.includes('\\colophon{')
        ? fullTex.replace('\\colophon{', `${authorsBlock}\n\n\\colophon{`)
        : fullTex;
  const texWithXmp = renderCtx.pdfxActive
    ? injectXmpMetadataIntoLatex(texWithAuthors, xmpMetadataFor(fm, lang, formatCfg?.pdf, ctx.siteConfig))
    : texWithAuthors;

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
      cover: resolveBooleanField(fm, formatCfg?.pdf, ctx.siteConfig, 'coverImage') === true,
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
): Promise<{ creator: string[]; title: string; subtitle: string | undefined; type: string | undefined; body: string }[]> {
  const files = doc.frontmatter.files;
  if (!files || files.length === 0) return [];

  const entries: { creator: string[]; title: string; subtitle: string | undefined; type: string | undefined; body: string }[] = [];
  for (const file of files) {
    const filePath = join(cwd, file);
    let text: string;
    try {
      text = await Bun.file(filePath).text();
    } catch {
      throw new BuildError(`collection "${doc.relativePath}": archivo configurado en files no encontrado: "${file}"`);
    }
    const parsed = parseFileFrontmatter(text);
    if (parsed.body.trim()) entries.push(parsed);
  }
  return entries;
}

function interventionSectionEntry(): { creator: string; title: string } {
  const creator = '$\\rule{8cm}{0.4pt}$\n\\textit{Nombre}';
  const title = '$\\rule{12cm}{0.4pt}$\n\\textit{Título}';
  return { creator, title };
}

function buildCollectionSectionsLatex(
  entries: { creator: string[]; title: string; subtitle: string | undefined; type: string | undefined; body: string }[],
  pageNumber?: string,
): string {
  const isHeader = pageNumber?.startsWith('header-');
  const parts: string[] = [];
  for (const e of entries) {
    const isIntervention = e.type === 'intervention';
    const resolved = isIntervention
      ? interventionSectionEntry()
      : { creator: e.creator.length > 0 ? e.creator.join(', ') : 'Anónima', title: e.title || 'Sin título' };
    parts.push(`\\chapter{${resolved.creator}}`);
    if (isHeader) parts.push('\\thispagestyle{empty}');
    if (e.subtitle) {
      parts.push(`\\RedeclareSectionCommand[style=section,beforeskip=2\\baselineskip,afterskip=1\\baselineskip,afterindent=false]{section}`);
      parts.push(`\\section{${resolved.title}}`);
      parts.push(`\\RedeclareSectionCommand[style=section,beforeskip=2\\baselineskip,afterskip=2\\baselineskip,afterindent=false]{section}`);
      parts.push(`\\subsection{${e.subtitle}}`);
    } else {
      parts.push(`\\section{${resolved.title}}`);
    }
    parts.push(e.body.trim());
  }
  return parts.join('\n\n');
}

function buildCollectionSectionsHtml(
  entries: { creator: string[]; title: string; subtitle: string | undefined; type: string | undefined; body: string }[],
): string {
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

function buildCollectionSectionsMarkdown(
  entries: { creator: string[]; title: string; subtitle: string | undefined; type: string | undefined; body: string }[],
): string {
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
  collectionEntries: { creator: string[]; title: string; subtitle: string | undefined; type: string | undefined; body: string }[],
  format: 'latex' | 'html' | 'markdown',
  fallback: string,
  pageNumber?: string,
): string {
  if (collectionEntries.length === 0) return fallback;
  if (format === 'latex') return buildCollectionSectionsLatex(collectionEntries, pageNumber);
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

function getCreatorLinks(fm: Record<string, unknown>): { name: string; url: string }[] {
  const links = fm.links;
  if (!Array.isArray(links)) return [];
  return links.filter(
    (l: unknown): l is Record<string, unknown> =>
      typeof l === 'object' &&
      l !== null &&
      typeof (l as Record<string, unknown>).name === 'string' &&
      typeof (l as Record<string, unknown>).url === 'string',
  ) as { name: string; url: string }[];
}

function prependLinksMarkdown(content: string, links: { name: string; url: string }[]): string {
  if (links.length === 0) return content;
  const md = links.map((l) => `**${l.name}**: ${l.url}`).join('\n');
  const { yaml, body } = splitFrontmatter(content);
  const prefix = yaml !== undefined ? `---\n${yaml}\n---\n` : '';
  return `${prefix}${md}\n\n${body.trimEnd()}`;
}

function prependLinksLatex(content: string, links: { name: string; url: string }[]): string {
  if (links.length === 0) return content;
  const latex = links.map((l) => `\\noindent \\textbf{${l.name}}: ${l.url}`).join('\n\n');
  const { yaml, body } = splitFrontmatter(content);
  const prefix = yaml !== undefined ? `---\n${yaml}\n---\n` : '';
  return `${prefix}${latex}\n\n\\vspace*{2\\baselineskip}\n\n\\noindent ${body.trimEnd()}`;
}

interface CreatorDoc {
  name: string;
  body: string;
  relativePath: string;
  links: { name: string; url: string }[];
}

async function collectCreatorNamesFromFiles(files: string[], cwd: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = await Bun.file(join(cwd, file)).text();
    } catch {
      continue;
    }
    const { yaml } = splitFrontmatter(text);
    if (!yaml) continue;
    try {
      const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
      extractCreatorNames(parsed.creator, names);
      extractCreatorNames(parsed.contributor, names);
    } catch {
      // skip unparseable files
    }
  }
  return names;
}

function extractCreatorNames(raw: unknown, target: Set<string>): void {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  for (const c of list) {
    if (typeof c === 'string' && c.trim()) target.add(c.trim());
  }
}

async function resolveSingleCreatorDoc(relativePath: string, cwd: string, collectionPath: string): Promise<CreatorDoc> {
  const filePath = join(cwd, relativePath);
  let text: string;
  try {
    text = await Bun.file(filePath).text();
  } catch {
    throw new BuildError(`collection "${collectionPath}": archivo de creator no encontrado: "${relativePath}"`);
  }
  const { yaml, body } = splitFrontmatter(text);
  let name = '';
  let links: { name: string; url: string }[] = [];
  if (yaml) {
    try {
      const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
      name = typeof parsed.name === 'string' && parsed.name ? parsed.name : typeof parsed.title === 'string' ? parsed.title : '';
      links = getCreatorLinks(parsed);
    } catch {
      // fall through
    }
  }
  if (!body.trim()) {
    throw new BuildError(`collection "${collectionPath}": creator "${name}" debe tener body (contenido después del frontmatter)`);
  }
  return { name, body, relativePath, links };
}

async function resolveCollectionCreatorDocs(
  doc: BuildDocument,
  discoveryIndex: Map<string, DiscoveryEntry>,
  cwd: string,
  collectionFm: Record<string, unknown>,
): Promise<CreatorDoc[]> {
  const files = doc.frontmatter.files;
  if (!files || files.length === 0) return [];

  const creatorNames = await collectCreatorNamesFromFiles(files, cwd);
  extractCreatorNames(collectionFm.contributor, creatorNames);
  if (creatorNames.size === 0) return [];

  const result: CreatorDoc[] = [];
  for (const [relativePath, entry] of discoveryIndex.entries()) {
    if (entry.type !== 'creator') continue;
    const name = (entry.fm?.name ?? entry.fm?.title ?? '') as string;
    if (!name || !creatorNames.has(name)) continue;
    result.push(await resolveSingleCreatorDoc(relativePath, cwd, doc.relativePath));
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function buildCollectionAuthorsLatex(creatorDocs: CreatorDoc[], sourcePath: string): Promise<string> {
  if (creatorDocs.length === 0) return '';
  const subsubsectionStyle =
    '\\RedeclareSectionCommand[beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}\n\\setkomafont{subsubsection}{\\raggedright\\normalsize\\normalfont\\scshape}';
  const subsubsectionReset =
    '\\RedeclareSectionCommand[beforeskip=\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}\n\\setkomafont{subsubsection}{\\normalsize\\normalfont\\bfseries}';
  const md = [`\\part{Autoras y colaboradoras}\n\n${subsubsectionStyle}`];
  for (const doc of creatorDocs) {
    md.push(`\\subsubsection{${doc.name}}`);
    if (doc.links.length > 0) {
      md.push(doc.links.map((l) => `\\noindent \\textbf{${l.name}}: ${l.url}`).join('\n\n'));
      md.push(`\\vspace*{\\baselineskip}\n\n\\noindent ${doc.body.trim()}`);
    } else {
      md.push(doc.body.trim());
    }
  }
  md.push(subsubsectionReset);
  const input = md.join('\n\n');
  return execPandoc({ input, sourcePath, from: MD_READER, to: 'latex', extraArgs: ['--shift-heading-level-by=2'] });
}

function collectionBaseContent(
  collectionEntries: { creator: string[]; title: string; subtitle: string | undefined; type: string | undefined; body: string }[],
  format: 'latex' | 'html' | 'markdown',
  content: string,
  pageNumber?: string,
): string {
  return collectionEntries.length > 0 ? resolveCollectionContent(collectionEntries, format, content, pageNumber) : content;
}

async function emitCollectionFormats(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  collectionEntries: { creator: string[]; title: string; subtitle: string | undefined; type: string | undefined; body: string }[],
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  formatWorkSets: FormatWorkSets,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan } = renderCtx;
  const { activeFormats } = plan;
  const content = outputs.content;
  const { formatCfg } = renderCtx;

  const creatorLinks = doc.frontmatter.type === 'creator' ? getCreatorLinks(outputs.fm) : [];
  const isCollection = doc.frontmatter.type === 'collection';

  if ((activeFormats.latex || activeFormats.pdf) && formatWorkSets.latexPaths.has(doc.relativePath)) {
    const pageNumber = (outputs.fm.pageNumber ?? formatCfg?.pdf?.pageNumber ?? ctx.siteConfig.pageNumber) as string | undefined;
    const base = collectionBaseContent(collectionEntries, 'latex', content, pageNumber);
    const creatorDocs = isCollection ? await resolveCollectionCreatorDocs(doc, discoveryIndex, ctx.cwd, outputs.fm) : [];
    const authorsBlock = await buildCollectionAuthorsLatex(creatorDocs, doc.filePath);
    await emitLatexAndQueuePdf(
      doc,
      { ...outputs, content: prependLinksLatex(base, creatorLinks) },
      renderCtx,
      exportCtx,
      formatWorkSets,
      authorsBlock,
    );
  }

  const exportDoc = assembleExportDocument(doc, renderCtx.lang, exportCtx.globalBibliography, exportCtx.globalCsl, ctx.siteConfig.toc);

  if (activeFormats.html && formatWorkSets.htmlPaths.has(doc.relativePath) && doc.frontmatter.type !== 'intervention') {
    const base = collectionBaseContent(collectionEntries, 'html', content);
    await emitHtmlPage(doc, { ...outputs, content: prependLinksMarkdown(base, creatorLinks) }, renderCtx, exportCtx, discoveryIndex);
  }

  if (activeFormats.epub && formatWorkSets.epubPaths.has(doc.relativePath) && doc.frontmatter.type !== 'intervention') {
    const base = collectionBaseContent(collectionEntries, 'html', content);
    await convertToEpub(
      prependLinksMarkdown(base, creatorLinks),
      outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('epub')}`),
      exportDoc,
      exportCtx.filters,
      ctx.siteConfig.toc,
      outputs.fm,
    );
  }

  if (activeFormats.markdown && formatWorkSets.mdPaths.has(doc.relativePath) && doc.frontmatter.type !== 'intervention') {
    const base = collectionBaseContent(collectionEntries, 'markdown', content);
    await convertToMarkdown(
      prependLinksMarkdown(base, creatorLinks),
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
  if (isCollection && entry?.aggregatedCreator) {
    doc.frontmatter.creator = entry.aggregatedCreator;
    entry.fm = { ...entry.fm, creator: entry.aggregatedCreator };
  }
  const collectionEntries = isCollection ? await readCollectionFiles(doc, ctx.cwd) : [];
  if (isCollection && collectionEntries.length === 0) {
    logWarning(`"${doc.relativePath}": collection sin contenido en files; se omite del build`, 'build');
    return;
  }

  const outputs = buildOutputs(entry, slug, outSlug, dir, content, ctx.outputDir);

  await emitCollectionFormats(doc, outputs, collectionEntries, renderCtx, exportCtx, formatWorkSets, discoveryIndex);
}
