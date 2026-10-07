import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, resolveBooleanField, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { execPandoc, MD_READER } from '../lib/pandoc-runner.js';
import { posix } from '../lib/paths.js';
import { isScriptCapture, recordSupportCommand, resolveScriptStdout } from '../lib/script-recorder.js';
import { extractFragment } from './collection-fragment.js';
import { computeSlug, htmlSlugFor } from './discover.js';
import { parseAuthors } from './discover-frontmatter.js';
import { assembleExportDocument, convertToEpub, convertToMarkdown, type ExportDocument } from './export.js';
import { MBOX_HELPERS_FILTER } from './filter-resolver.js';
import { imagePathsMap, relImageMapFor, rewriteFmImagePaths, rewriteImagePaths } from './image-processor.js';
import {
  buildTexDistribution,
  composeLatexFinalOutput,
  type ImagePreprocessResult,
  insertAuthorsBlock,
  type LatexPostManifest,
  markdownToLatex,
  mergeConfigImages,
  preprocessDocumentImages,
} from './latex-composer.js';
import { detectPageSize } from './latex-preamble.js';
import { ASSETS_CSS_FILE, ASSETS_IMAGES_DIR, docProducesFormat, primaryOutputExtension } from './output-layout.js';
import { formatLinksFor, parseFileFrontmatter, readMarkdownOrWarn, relativeHref, writeOutput } from './pipeline-io.js';
import { type ExportContext, type FormatWorkSets, htmlKindFor, latexKindFor, type RenderContext } from './pipeline-setup.js';
import { htmlPageFromMarkdown } from './render.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';
import type { PdfXmpMetadata } from './xmpdata.js';
import { injectXmpMetadataIntoLatex, XMP_FIELDS } from './xmpdata.js';

function htmlMetadataField(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  siteConfig: SiteConfig,
  field: string,
): string | undefined {
  const resolved = resolveMetadataField(fm, formatCfg, siteConfig, field);
  if (resolved === undefined) return undefined;
  const joined = Array.isArray(resolved) ? resolved.join(', ') : String(resolved);
  return joined || undefined;
}

function docChipLabel(type: string | undefined): string {
  if (type === 'collection') return 'Colección';
  if (type === 'creator') return 'Creadora';
  return 'Texto';
}

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
  const meta: Record<string, unknown> = {};
  for (const { key, fm: field, kind } of XMP_FIELDS) {
    if (field === null) {
      meta[key] = lang;
    } else if (kind === 'list') {
      meta[key] = fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, field));
    } else {
      meta[key] = resolveStringField(fm, formatCfg, rootCfg, field);
    }
  }

  meta.subject = fmStringList(resolveMetadataField(fm, formatCfg, rootCfg, 'subject'))?.join(', ');
  meta.doi = resolveStringField(fm, formatCfg, rootCfg, 'doi');
  meta.isbn = resolveStringField(fm, formatCfg, rootCfg, 'isbn');
  return meta as PdfXmpMetadata;
}

async function writeImagePaths(
  doc: BuildDocument,
  cwd: string,
  format: 'latex' | 'html' | 'epub',
  imageMap: Map<string, string>,
  docDir: string,
  relativize: boolean,
): Promise<string> {
  const path = resolve(cwd, '.iteraciones', 'paths', `${doc.relativePath}.${format}.json`);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(imagePathsMap(imageMap, docDir, relativize))}\n`);
  return path;
}

async function emitLatexAndQueuePdf(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  sets: FormatWorkSets,
  images: ImagePreprocessResult,
  authorsBlock = '',
): Promise<void> {
  const { ctx, lang, warnedLangs, formatCfg, plan } = renderCtx;
  const latexOn = plan.activeFormats.latex;
  const pdfOn = plan.activeFormats.pdf;
  const { dir, outBase, outSlug, fm } = outputs;
  const texDistPath = outBase(`${outSlug}${primaryOutputExtension('latex')}`);

  const imagePaths = await writeImagePaths(doc, ctx.cwd, 'latex', images.imageMap, dirname(doc.filePath), false);
  const { tex: fullTex, processedImages } = await markdownToLatex(outputs.content, doc, {
    filters: exportCtx.filters,
    bibFiles: exportCtx.bibFiles,
    inputTarget: await collectionPandocInput(doc, ctx.cwd, outSlug, 'latex'),
    imagePaths,
    templatePath: exportCtx.templates[latexKindFor(doc.frontmatter.type)],
    fm,
    siteConfig: ctx.siteConfig,
    formatCfg: formatCfg?.pdf,
    biblatexAvailable: exportCtx.biblatexAvailable,
    warnedLangs,
    images,
    cwd: ctx.cwd,
  });
  const xmp = renderCtx.pdfxActive ? xmpMetadataFor(fm, lang, formatCfg?.pdf, ctx.siteConfig) : undefined;

  if (latexOn) {
    const texDir = dirname(texDistPath);
    const distribution = buildTexDistribution(processedImages);

    const manifest: LatexPostManifest = {
      authorsBlock,
      xmp,
      distribution: Object.fromEntries(distribution),
      projectRoot: ctx.cwd,
      distRoot: ctx.outputDir,
      bundle: ctx.siteConfig.bundle === true,
    };
    const distTex = await composeLatexFinalOutput(fullTex, manifest, texDir);

    let post: string[] | undefined;
    if (isScriptCapture()) {
      const manifestPath = resolve(ctx.cwd, '.iteraciones', 'post', `${doc.relativePath}.json`);
      await writeOutput(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      post = ['iteraciones', 'post', 'latex', '--post', manifestPath, '-o', texDistPath];
    }
    resolveScriptStdout(fullTex, texDistPath, distTex, post);
    await writeOutput(texDistPath, distTex);
  }

  if (pdfOn) {
    const texWithAuthors = insertAuthorsBlock(fullTex, authorsBlock);
    const texWithXmp = xmp === undefined ? texWithAuthors : injectXmpMetadataIntoLatex(texWithAuthors, xmp);
    const texPath = join(exportCtx.pdfWorkDir, dir, `${outSlug}${primaryOutputExtension('latex')}`);
    await writeOutput(texPath, texWithXmp);
    sets.pdfJobs.push({
      dir,
      slug: outSlug,
      relativePath: doc.relativePath,
      texPath,
      pdfDest: outBase(`${outSlug}${primaryOutputExtension('pdf')}`),
      cover: resolveBooleanField(fm, formatCfg?.pdf, ctx.siteConfig, 'coverImage') === true,

      noBibtex: exportCtx.bibFiles.length === 0,
    });
  }
}

async function emitHtmlPage(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  discoveryIndex: Map<string, DiscoveryEntry>,
  imagePaths?: string,
): Promise<void> {
  const { ctx, plan, formatCfg, lang } = renderCtx;
  const htmlConfig = formatCfg?.html;
  const { dir, outBase, outSlug, slug, fm, content } = outputs;
  const cwd = ctx.cwd;

  const formats = formatLinksFor(plan, dir, outSlug);
  const hasHomePage = discoveryIndex.has('index.md');
  const htmlPath = outBase(`${outSlug}${primaryOutputExtension('html')}`);

  const htmlType = doc.frontmatter.type === 'collection' || doc.frontmatter.type === 'creator' ? doc.frontmatter.type : 'file';
  const html = await htmlPageFromMarkdown(content, doc, {
    cwd,
    inputTarget: await collectionPandocInput(doc, cwd, outSlug, 'html'),
    imagePaths,
    templatePath: exportCtx.templates[htmlKindFor(htmlType)],
    refsCardTemplate: exportCtx.refsCardTemplates[htmlType],
    docType: htmlType,
    vars: {
      title: doc.frontmatter.title || slug,
      siteTitle: htmlConfig?.site?.title ?? 'iteraciones',
      tagline: htmlConfig?.site?.description ?? 'escribir, compartir, re-existir',
      lang,
      theme: htmlConfig?.site?.theme,
      accent: htmlConfig?.site?.color,
      css: ctx.needsCss ? relativeHref(dir, ASSETS_CSS_FILE) : undefined,
      authorMeta: doc.frontmatter.creator.join(', '),
      docTitle: doc.frontmatter.title && doc.frontmatter.title !== TITULO_POR_DEFECTO ? doc.frontmatter.title : undefined,
      subtitle: doc.frontmatter.subtitle,
      date: formatHumanDate(doc.frontmatter.date),
      homeHref: hasHomePage ? relativeHref(dir, 'index.html') : undefined,
      formats: formats.length > 0 ? formats : undefined,

      titlehead: htmlMetadataField(fm, htmlConfig, ctx.siteConfig, 'titlehead'),
      subject: htmlMetadataField(fm, htmlConfig, ctx.siteConfig, 'subject'),
      publishers: htmlMetadataField(fm, htmlConfig, ctx.siteConfig, 'publishers'),
      collectionCreatorPrefix: resolveStringField(fm, htmlConfig, ctx.siteConfig, 'collectionCreatorPrefix'),
      collectionCreator: parseAuthors(resolveMetadataField(fm, htmlConfig, ctx.siteConfig, 'collectionCreator')),
      authors: doc.frontmatter.creator,
      docChip: docChipLabel(doc.frontmatter.type),
    },
    siteConfig: ctx.siteConfig,
    fm,
    bibOptions: exportCtx.bibOptions,
    luaFilters: exportCtx.filters,
    scriptOutputPath: htmlPath,
  });
  await writeOutput(htmlPath, html);
}

const AUTORA_POR_DEFECTO = 'Anónima';
const TITULO_POR_DEFECTO = 'Sin título';

export type CollectionEntry = {
  file: string;
  title: string;
  creator: string[];
  subtitle: string | undefined;
  type: string | undefined;
  lineLength: number | undefined;
  pages: number | undefined;
  body: string;
};

export async function readCollectionEntries(files: string[], collectionPath: string, bases: string[]): Promise<CollectionEntry[]> {
  const entries: CollectionEntry[] = [];
  for (const file of files) {
    const candidates = [...new Set(bases.map((base) => join(base, file)))];
    let text: string | undefined;
    for (const candidate of candidates) {
      try {
        text = await Bun.file(candidate).text();
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          throw new BuildError(`collection "${collectionPath}": no se pudo leer "${candidate}": ${(err as Error).message}`);
        }
      }
    }
    if (text === undefined) {
      throw new BuildError(
        `collection "${collectionPath}": archivo configurado en files no encontrado: "${file}" (probado: ${candidates.join(', ')})`,
      );
    }
    const parsed = parseFileFrontmatter(text);

    const rootRelative = posix(file).replace(/^\.\//, '');
    if (parsed.body.trim()) entries.push({ file: rootRelative, ...parsed });
  }
  return entries;
}

async function readCollectionFiles(doc: BuildDocument, cwd: string): Promise<CollectionEntry[]> {
  const files = doc.frontmatter.files;
  if (!files || files.length === 0) return [];
  return readCollectionEntries(files, doc.relativePath, [cwd, join(cwd, dirname(doc.relativePath))]);
}

export function memberSlugMap(rootFiles: string[], discoveryIndex: Map<string, DiscoveryEntry>): Map<string, string> {
  const slugs = new Map<string, string>();
  for (const file of rootFiles) {
    const slug = discoveryIndex.get(file)?.slug;
    if (slug !== undefined) slugs.set(file, slug);
  }
  return slugs;
}

function memberMarkdownPath(memberSlugs: Map<string, string> | undefined, outputDir: string, file: string): string {
  const slug = memberSlugs?.get(file);
  if (slug === undefined) return join(outputDir, normalize(file));
  return join(outputDir, dirname(file), `${htmlSlugFor(file, slug)}.md`);
}

export async function writeDistMarkdown(p: {
  label: string;
  content: string;
  outPath: string;
  outputDir: string;
  fm: Record<string, unknown>;
  exportDoc: ExportDocument;
  relImageMap: Map<string, string>;
  docDir: string;
  creatorLinks: { name: string; url: string }[];

  rootFiles?: string[];

  memberSlugs?: Map<string, string>;

  merge: boolean;
  entries: CollectionEntry[];
}): Promise<void> {
  const { label, outPath, outputDir, rootFiles, merge } = p;
  const mdFm: Record<string, unknown> = { ...p.fm };
  if (rootFiles !== undefined) {
    if (!merge) delete mdFm.creator;

    if (mdFm.slug === undefined) {
      const derived = computeSlug(
        { title: typeof mdFm.title === 'string' ? mdFm.title : undefined, creator: parseAuthors(mdFm.collectionCreator) },
        { fallbackPath: label },
      );
      if (derived !== undefined) mdFm.slug = derived;
    }
    const outDir = dirname(outPath);
    mdFm.files = rootFiles.map((f) => {
      if (p.memberSlugs !== undefined && !p.memberSlugs.has(f)) {
        logWarning(
          `"${label}": files contiene "${f}", que no forma parte de los documentos del proyecto; files[] conserva su nombre de origen`,
          'build',
        );
      }
      return relative(outDir, memberMarkdownPath(p.memberSlugs, outputDir, f))
        .split(sep)
        .join('/');
    });
  }
  const base = merge ? collectionBaseContent(p.entries, 'markdown', p.content) : p.content;
  await convertToMarkdown(rewriteImagePaths(prependLinksMarkdown(base, p.creatorLinks), p.relImageMap, p.docDir), outPath, p.exportDoc, mdFm, merge);
  recordSupportCommand('post', outPath, ['iteraciones', 'markdown', label, '-o', outPath]);
}

function interventionSectionRaw(lineLength = 0.5): string {
  const rule = `\\rule{${lineLength}\\textwidth}{0.4pt}`;
  return `\`\`\`{=latex}
\\RedeclareSectionCommand[style=chapter,beforeskip=2\\baselineskip,afterskip=0pt,afterindent=false]{chapter}
\\RedeclareSectionCommand[style=section,beforeskip=0pt,afterskip=1pt,afterindent=false]{section}
\\chapter{${rule}}
\\raisebox{12pt}{\\makebox[\\textwidth][c]{\\normalfont\\footnotesize Nombre}}
\\section{${rule}}
\\raisebox{12pt}{\\makebox[\\textwidth][c]{\\normalfont\\footnotesize Título}}
\\RedeclareSectionCommand[style=chapter,beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{chapter}
\\RedeclareSectionCommand[style=section,beforeskip=2\\baselineskip,afterskip=2\\baselineskip,afterindent=false]{section}
\`\`\``;
}

function buildCollectionEntryLatex(e: CollectionEntry, isHeader: boolean): string[] {
  const parts: string[] = [];
  if (e.type === 'intervention') {
    parts.push(interventionSectionRaw(e.lineLength));
    parts.push('\\thispagestyle{empty}');
    parts.push(e.body.trim());
    if (e.pages && e.pages > 0) {
      parts.push('\\thispagestyle{empty}\n\\null\\newpage\n'.repeat(e.pages).trim());
    }
  } else {
    const creator = e.creator.length > 0 ? e.creator.join(', ') : AUTORA_POR_DEFECTO;
    const title = e.title || TITULO_POR_DEFECTO;
    parts.push(`\\chapter{${creator}}`);
    if (isHeader) parts.push('\\thispagestyle{empty}');
    if (e.subtitle) {
      parts.push(`\\RedeclareSectionCommand[style=section,beforeskip=2\\baselineskip,afterskip=1\\baselineskip,afterindent=false]{section}`);
      parts.push(`\\section{${title}}`);
      parts.push(`\\RedeclareSectionCommand[style=section,beforeskip=2\\baselineskip,afterskip=2\\baselineskip,afterindent=false]{section}`);
      parts.push(`\\subsection{${e.subtitle}}`);
    } else {
      parts.push(`\\section{${title}}`);
    }
    parts.push(e.body.trim());
  }
  return parts;
}

function buildCollectionSectionsLatex(entries: CollectionEntry[], pageNumber?: string): string {
  const isHeader = pageNumber?.startsWith('header-') ?? false;
  const parts: string[] = [];
  for (const e of entries) {
    parts.push(...buildCollectionEntryLatex(e, isHeader));
  }
  return parts.join('\n\n');
}

type Heading = readonly [string, string];
type Headings = readonly [Heading, Heading, Heading];

const HTML_HEADINGS: Headings = [
  ['<h2>', '</h2>'],
  ['<h3>', '</h3>'],
  ['<h4>', '</h4>'],
];
const MARKDOWN_HEADINGS: Headings = [
  ['## ', ''],
  ['### ', ''],
  ['#### ', ''],
];

function buildCollectionSections(entries: CollectionEntry[], headings: Headings): string {
  const parts: string[] = [];
  for (const e of entries) {
    const creator = e.creator.length > 0 ? e.creator.join(', ') : AUTORA_POR_DEFECTO;
    const title = e.title || TITULO_POR_DEFECTO;
    parts.push(`${headings[0][0]}${creator}${headings[0][1]}`);
    parts.push(`${headings[1][0]}${title}${headings[1][1]}`);
    if (e.subtitle) parts.push(`${headings[2][0]}${e.subtitle}${headings[2][1]}`);
    parts.push(e.body.trim());
  }
  return parts.join('\n\n');
}

function buildCollectionSectionsHtml(entries: CollectionEntry[]): string {
  return buildCollectionSections(entries, HTML_HEADINGS);
}

export function memberHtmlHrefs(collectionPath: string, entries: CollectionEntry[], slugIndex: Map<string, DiscoveryEntry>): Map<string, string> {
  const dir = dirname(collectionPath);
  const hrefs = new Map<string, string>();
  for (const e of entries) {
    const slug = slugIndex.get(e.file)?.slug;
    if (slug === undefined) continue;
    const html = join(dirname(e.file), `${htmlSlugFor(e.file, slug)}.html`)
      .split(sep)
      .join('/');
    hrefs.set(e.file, relativeHref(dir, html));
  }
  return hrefs;
}

function printableEntries<T extends { type: string | undefined }>(entries: T[]): T[] {
  return entries.filter((e) => e.type !== 'intervention');
}

export function collectionCardsContent(entries: CollectionEntry[], memberHrefs: Map<string, string>, content: string): string {
  if (entries.length === 0) return content;
  const cards: string[] = [];
  const intro = splitFrontmatter(content).body.trim();
  if (intro !== '') cards.push([':::: {class="collection-intro"}', '', intro, '', '::::'].join('\n'));
  for (const e of printableEntries(entries)) cards.push(collectionCard(e, memberHrefs.get(e.file)));
  return cards.join('\n\n');
}

export function collectionScanContent(entries: CollectionEntry[], content: string): string {
  if (entries.length === 0) return content;
  const body = splitFrontmatter(content).body;
  const sections = collectionBaseContent(entries, 'latex', content);
  return body.trim() === '' ? sections : `${sections}\n\n${body}`;
}

const MASONRY_WRAPPER = '<div class="break-inside-avoid pb-6">';

const CARD_TEXT_CLASSES =
  'prose prose-xl dark:prose-invert max-w-none [--tw-prose-links:var(--color-accent-600)] [--tw-prose-invert-links:var(--color-accent-500)]';

const CARD_CORNERS =
  "[&::before]:pointer-events-none [&::before]:absolute [&::before]:left-2 [&::before]:top-2 [&::before]:h-3 [&::before]:w-3 [&::before]:border-l [&::before]:border-t [&::before]:border-accent-500/30 [&::before]:content-[''] [&::after]:pointer-events-none [&::after]:absolute [&::after]:bottom-2 [&::after]:right-2 [&::after]:h-3 [&::after]:w-3 [&::after]:border-b [&::after]:border-r [&::after]:border-accent-500/30 [&::after]:content-['']";

const COLLECTION_CARD_CLASSES = `tarjeta-fragmento relative rounded-tr-xl rounded-bl-xl border border-accent-500/25 bg-stone-50/75 dark:bg-stone-900/65 p-6 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 [overflow-wrap:anywhere] ${CARD_CORNERS} ${CARD_TEXT_CLASSES}`;

const MEMBER_PILL_CLASSES =
  'inline-block align-top rounded-full border border-accent-500/40 bg-accent-500/15 px-3 py-1 font-normal uppercase tracking-wide text-xs leading-none mt-0 mb-6 text-accent-600 dark:text-accent-400';

const MEMBER_TYPE_LABEL: Record<string, string> = { file: 'Texto', creator: 'Creadora' };

const LINK_STRETCH_CLASSES = 'after:absolute after:inset-0';

function collectionCard(e: CollectionEntry, href: string | undefined): string {
  const creator = e.creator.length > 0 ? e.creator.map((n) => `<span class="whitespace-nowrap">${n}</span>`).join(', ') : AUTORA_POR_DEFECTO;
  const title = e.title || TITULO_POR_DEFECTO;
  const fragment = extractFragment(e.body);

  const card = [`:::: {class="${COLLECTION_CARD_CLASSES}"}`, ''];
  const typeLabel = MEMBER_TYPE_LABEL[e.type ?? 'file'];
  if (typeLabel !== undefined) card.push(`<h2 class="${MEMBER_PILL_CLASSES}">${typeLabel}</h2>`, '');
  card.push(
    `<h2 class="text-center text-xl">${creator}</h2>`,
    '',
    `<h3 class="text-center text-2xl text-accent-700 dark:text-accent-300">${title}</h3>`,
  );
  if (e.subtitle) card.push('', `<h4 class="text-center text-xl uppercase tracking-wide">${e.subtitle}</h4>`);
  if (fragment !== '') card.push('', fragment);
  if (href !== undefined) {
    card.push('', `<p class="text-center"><a href="${href}" class="${LINK_STRETCH_CLASSES}">Leer el texto completo →</a></p>`);
  }
  card.push('', '::::');
  return [MASONRY_WRAPPER, '', ...card, '', '</div>'].join('\n');
}

export function buildCollectionSectionsMarkdown(entries: CollectionEntry[]): string {
  return buildCollectionSections(entries, MARKDOWN_HEADINGS);
}

function resolveCollectionContent(
  collectionEntries: CollectionEntry[],
  format: 'latex' | 'html' | 'markdown',
  fallback: string,
  pageNumber?: string,
): string {
  if (collectionEntries.length === 0) return fallback;
  if (format === 'latex') return buildCollectionSectionsLatex(collectionEntries, pageNumber);
  if (format === 'html') {
    const printable = printableEntries(collectionEntries);
    return printable.length === 0 ? fallback : buildCollectionSectionsHtml(printable);
  }
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

export function getCreatorLinks(fm: Record<string, unknown>): { name: string; url: string }[] {
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

function creatorLinksInlineMd(links: { name: string; url: string }[]): string {
  return links.map((l) => `**${l.name}**: ${l.url}`).join('\n');
}

export function prependLinksMarkdown(content: string, links: { name: string; url: string }[]): string {
  if (links.length === 0) return content;
  const { yaml, body } = splitFrontmatter(content);
  const md = creatorLinksInlineMd(links);

  if (body.startsWith(md)) return content;
  const prefix = yaml !== undefined ? `---\n${yaml}\n---\n` : '';
  return `${prefix}${md}\n\n${body.trimEnd()}`;
}

function prependLinksLatex(content: string, links: { name: string; url: string }[]): string {
  if (links.length === 0) return content;
  const { yaml, body } = splitFrontmatter(content);

  if (body.startsWith(creatorLinksInlineMd(links))) return content;
  const latex = links.map((l) => `\\noindent \\textbf{${l.name}}: ${l.url}`).join('\n\n');
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
    } catch {}
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
    } catch {}
  }
  if (!body.trim()) {
    throw new BuildError(`collection "${collectionPath}": creator "${name}" debe tener body (contenido después del frontmatter)`);
  }
  return { name, body, relativePath, links };
}

export async function resolveCollectionCreatorDocs(
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

async function buildCollectionAuthorsLatex(creatorDocs: CreatorDoc[], sourcePath: string, filters: ExportContext['filters']): Promise<string> {
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
  const extraArgs = ['--shift-heading-level-by=2'];
  for (const f of [...filters.semantic, ...filters.latex]) {
    extraArgs.push('--lua-filter', f);
  }
  return execPandoc({
    input,
    sourcePath,
    from: MD_READER,
    to: 'latex',
    extraArgs,
    env: { ITERACIONES_MBOX_HELPERS: MBOX_HELPERS_FILTER },
  });
}

export function collectionBaseContent(
  collectionEntries: CollectionEntry[],
  format: 'latex' | 'html' | 'markdown',
  content: string,
  pageNumber?: string,
): string {
  return collectionEntries.length > 0 ? resolveCollectionContent(collectionEntries, format, content, pageNumber) : content;
}

async function collectionPandocInput(
  doc: BuildDocument,
  cwd: string,
  outSlug: string,
  format: 'latex' | 'html' | 'epub',
): Promise<string | undefined> {
  if (doc.frontmatter.type !== 'collection') return undefined;
  const path = resolve(cwd, '.iteraciones', 'collections', `${doc.relativePath}.${format}.md`);
  recordSupportCommand('resources', path, ['iteraciones', 'merge', doc.relativePath, '--format', format, '--slug', outSlug, '-o', path]);
  return path;
}

async function emitCollectionFormats(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  collectionEntries: CollectionEntry[],
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  formatWorkSets: FormatWorkSets,
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan } = renderCtx;
  const { activeFormats } = plan;
  const content = outputs.content;
  const { formatCfg } = renderCtx;

  const images = await preprocessDocumentImages(
    collectionScanContent(collectionEntries, content),
    doc,
    mergeConfigImages(outputs.fm, formatCfg?.pdf, ctx.siteConfig, ctx.cwd),
    renderCtx.pageDimensions ?? detectPageSize([]),
    renderCtx.cropActive,
    renderCtx.pdfxActive,
    outputs.outBase(ASSETS_IMAGES_DIR),
    outputs.outSlug,
  );
  const docDir = dirname(doc.filePath);
  const relImageMap = relImageMapFor(images.imageMap);

  const fmAssets = rewriteFmImagePaths(outputs.fm, relImageMap, docDir);

  const creatorLinks = doc.frontmatter.type === 'creator' ? getCreatorLinks(outputs.fm) : [];
  const isCollection = doc.frontmatter.type === 'collection';

  if ((activeFormats.latex || activeFormats.pdf) && formatWorkSets.latexPaths.has(doc.relativePath)) {
    const pageNumber = (outputs.fm.pageNumber ?? formatCfg?.pdf?.pageNumber ?? ctx.siteConfig.pageNumber) as string | undefined;
    const base = collectionBaseContent(collectionEntries, 'latex', content, pageNumber);
    const creatorDocs = isCollection ? await resolveCollectionCreatorDocs(doc, discoveryIndex, ctx.cwd, outputs.fm) : [];
    const authorsBlock = await buildCollectionAuthorsLatex(creatorDocs, doc.filePath, exportCtx.filters);
    await emitLatexAndQueuePdf(
      doc,
      { ...outputs, content: prependLinksLatex(base, creatorLinks) },
      renderCtx,
      exportCtx,
      formatWorkSets,
      images,
      authorsBlock,
    );
  }

  const exportDoc = assembleExportDocument(doc, renderCtx.lang, exportCtx.globalBibliography, exportCtx.globalCsl, ctx.siteConfig.toc);

  if (activeFormats.html && formatWorkSets.htmlPaths.has(doc.relativePath) && docProducesFormat(doc.frontmatter.type, 'html')) {
    const base = collectionCardsContent(collectionEntries, memberHtmlHrefs(doc.relativePath, collectionEntries, discoveryIndex), content);

    const imagePaths = await writeImagePaths(doc, ctx.cwd, 'html', images.imageMap, docDir, true);
    await emitHtmlPage(doc, { ...outputs, content: prependLinksMarkdown(base, creatorLinks) }, renderCtx, exportCtx, discoveryIndex, imagePaths);
  }

  if (activeFormats.epub && formatWorkSets.epubPaths.has(doc.relativePath) && docProducesFormat(doc.frontmatter.type, 'epub')) {
    const base = collectionBaseContent(collectionEntries, 'html', content);
    const imagePaths = await writeImagePaths(doc, ctx.cwd, 'epub', images.imageMap, docDir, false);
    await convertToEpub(
      prependLinksMarkdown(base, creatorLinks),
      outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('epub')}`),
      exportDoc,
      exportCtx.filters,
      ctx.siteConfig.toc,
      outputs.fm,
      await collectionPandocInput(doc, ctx.cwd, outputs.outSlug, 'epub'),
      imagePaths,
    );
  }

  await emitCollectionMarkdown(
    doc,
    outputs,
    collectionEntries,
    renderCtx,
    exportDoc,
    formatWorkSets,
    creatorLinks,
    {
      relImageMap,
      docDir,
      fmAssets,
    },
    discoveryIndex,
  );
}

async function emitCollectionMarkdown(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  collectionEntries: CollectionEntry[],
  renderCtx: RenderContext,
  exportDoc: ExportDocument,
  formatWorkSets: FormatWorkSets,
  creatorLinks: { name: string; url: string }[],
  assets: { relImageMap: Map<string, string>; docDir: string; fmAssets: Record<string, unknown> },
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan, formatCfg } = renderCtx;
  if (!plan.activeFormats.markdown || !formatWorkSets.mdPaths.has(doc.relativePath)) return;

  const { relImageMap, docDir, fmAssets } = assets;
  const outPath = outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('markdown')}`);
  const isCollection = doc.frontmatter.type === 'collection';
  const rootFiles = isCollection ? (doc.frontmatter.files ?? []) : undefined;

  await writeDistMarkdown({
    label: doc.relativePath,
    content: outputs.content,
    outPath,
    outputDir: ctx.outputDir,
    fm: fmAssets,
    exportDoc,
    relImageMap,
    docDir,
    creatorLinks,
    rootFiles,
    memberSlugs: rootFiles === undefined ? undefined : memberSlugMap(rootFiles, discoveryIndex),
    merge: isCollection && formatCfg?.markdown?.merge === true,
    entries: collectionEntries,
  });
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

  if (isCollection && printableEntries(collectionEntries).length === 0) {
    throw new BuildError(
      `"${doc.relativePath}": todos los archivos de files[] son "type: intervention"; una collection necesita al menos un archivo de otro tipo (las interventions solo salen en el PDF y en el markdown exportado)`,
    );
  }

  const outputs = buildOutputs(entry, slug, outSlug, dir, content, ctx.outputDir);

  await emitCollectionFormats(doc, outputs, collectionEntries, renderCtx, exportCtx, formatWorkSets, discoveryIndex);
}
