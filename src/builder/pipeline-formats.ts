import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_FORMAT } from '../config/site-config.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, resolveBooleanField, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { minifyHtml } from '../lib/minify.js';
import { execPandoc, imagePathsEnv, MD_READER } from '../lib/pandoc-runner.js';
import { posix } from '../lib/paths.js';
import { isScriptCapture, recordSupportCommand, resolveScriptStdout } from '../lib/script-recorder.js';
import { htmlOwner, removeExtraHtmlPages } from './cleanup.js';
import { extractFragment } from './collection-fragment.js';
import { DEFAULT_LISTS, defaultListHref } from './default-lists.js';
import { computeSlug, htmlSlugFor } from './discover.js';
import { parseAuthors } from './discover-frontmatter.js';
import { assembleExportDocument, convertToEpub, convertToMarkdown, type ExportDocument } from './export.js';
import { MBOX_HELPERS_FILTER } from './filter-resolver.js';
import type { HtmlDocType, HtmlPageVars } from './html-composer.js';
import {
  imageNamerFor,
  imagePathsMap,
  processDocumentImages,
  relImageMapFor,
  rewriteFmImagePaths,
  rewriteImagePaths,
  scanInlineImages,
} from './image-processor.js';
import {
  buildTexDistribution,
  composeLatexFinalOutput,
  type ImagePreprocessResult,
  insertAuthorsBlock,
  type LatexPostManifest,
  markdownToLatex,
  mergeConfigImages,
  preprocessDocumentImages,
  removeEmptyToc,
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
  if (type === 'list') return 'Lista';
  return 'Texto';
}

export interface DocumentOutputs {
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

export async function writeImagePaths(
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

  // El índice se quita antes de meter el bloque de autoras: ese bloque es
  // propio de la CLI y no cuenta como contenido del documento.
  const tex = removeEmptyToc(fullTex);

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
    const distTex = await composeLatexFinalOutput(tex, manifest, texDir);

    let post: string[] | undefined;
    if (isScriptCapture()) {
      const manifestPath = resolve(ctx.cwd, '.iteraciones', 'post', `${doc.relativePath}.json`);
      await writeOutput(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      post = ['iteraciones', 'post', 'latex', '--post', manifestPath, '-o', texDistPath];
    }
    resolveScriptStdout(tex, texDistPath, distTex, post);
    await writeOutput(texDistPath, distTex);
  }

  if (pdfOn) {
    const texWithAuthors = insertAuthorsBlock(tex, authorsBlock);
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

function htmlVars(args: {
  doc: BuildDocument;
  outputs: DocumentOutputs;
  renderCtx: RenderContext;
  formats: HtmlPageVars['formats'];
  hasHomePage: boolean;
  creatorHrefs: Map<string, string>;
  extras: string;
  pagination: string;
}): HtmlPageVars {
  const { doc, outputs, renderCtx, formats, hasHomePage, creatorHrefs, extras, pagination } = args;
  const { ctx, lang, formatCfg } = renderCtx;
  const htmlConfig = formatCfg?.html;
  const { dir, slug, fm } = outputs;
  const titulo = doc.frontmatter.title || slug;
  return {
    title: titulo,
    siteTitle: htmlConfig?.site?.title ?? 'iteraciones',
    tagline: htmlConfig?.site?.description ?? 'escribir, compartir, re-existir',
    lang,
    theme: htmlConfig?.site?.theme,
    css: ctx.needsCss ? relativeHref(dir, ASSETS_CSS_FILE) : undefined,
    authorMeta: doc.frontmatter.creator.join(', '),
    docTitle: doc.frontmatter.title && doc.frontmatter.title !== TITULO_POR_DEFECTO ? doc.frontmatter.title : undefined,
    subtitle: doc.frontmatter.subtitle,
    date: formatHumanDate(doc.frontmatter.date),
    homeHref: hasHomePage ? relativeHref(dir, 'index.html') : undefined,
    formats: formats && formats.length > 0 ? formats : undefined,

    titlehead: htmlMetadataField(fm, htmlConfig, ctx.siteConfig, 'titlehead'),
    subject: htmlMetadataField(fm, htmlConfig, ctx.siteConfig, 'subject'),
    publishers: htmlMetadataField(fm, htmlConfig, ctx.siteConfig, 'publishers'),
    collectionCreatorPrefix: resolveStringField(fm, htmlConfig, ctx.siteConfig, 'collectionCreatorPrefix'),
    collectionCreator: nombresEnlazados(parseAuthors(resolveMetadataField(fm, htmlConfig, ctx.siteConfig, 'collectionCreator')), creatorHrefs),
    authors: nombresEnlazados(doc.frontmatter.creator, creatorHrefs),
    docChip: docChipLabel(doc.frontmatter.type),
    docChipHref: defaultListHref(dir, doc.frontmatter.type),
    extras: extras === '' ? undefined : extras,
    pagination: pagination === '' ? undefined : pagination,
  };
}

export async function emitHtmlPage(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  discoveryIndex: Map<string, DiscoveryEntry>,
  imagePaths?: string,
  paginas?: string[],
  creatorHrefs: Map<string, string> = new Map(),
  extras = '',
): Promise<void> {
  const { ctx, plan } = renderCtx;
  const { dir, outBase, outSlug, content } = outputs;
  const cwd = ctx.cwd;

  const formats = formatLinksFor(plan, dir, outSlug, doc.frontmatter.type);
  const hasHomePage = discoveryIndex.has('index.md');

  const htmlType: HtmlDocType =
    doc.frontmatter.type === 'collection' || doc.frontmatter.type === 'creator' || doc.frontmatter.type === 'list' ? doc.frontmatter.type : 'file';
  const contenidos = paginas ?? [content];
  for (const [indice, contenido] of contenidos.entries()) {
    const slugPagina = indice === 0 ? outSlug : `${outSlug}-${indice + 1}`;
    const htmlPath = outBase(`${slugPagina}${primaryOutputExtension('html')}`);
    const pagination = paginationNav(dir, outSlug, indice + 1, contenidos.length);
    const html = await htmlPageFromMarkdown(contenido, doc, {
      cwd,
      inputTarget: await collectionPandocInput(doc, cwd, outSlug, 'html'),
      imagePaths,
      templatePath: exportCtx.templates[htmlKindFor(htmlType)],
      refsCardTemplate: exportCtx.refsCardTemplates[htmlType],
      docType: htmlType,
      vars: htmlVars({ doc, outputs, renderCtx, formats, hasHomePage, creatorHrefs, extras, pagination }),
      siteConfig: ctx.siteConfig,
      fm: outputs.fm,
      bibOptions: exportCtx.bibOptions,
      luaFilters: exportCtx.filters,
      scriptOutputPath: htmlPath,
    });
    await writeOutput(htmlPath, html);
  }
}

const AUTORA_POR_DEFECTO = 'Anónima';
const TITULO_POR_DEFECTO = 'Sin título';

export type CollectionEntry = {
  file: string;
  posicion: number;
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
  for (const [indice, file] of files.entries()) {
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
    const parsed = parseFileFrontmatter(text, file);

    const rootRelative = posix(file).replace(/^\.\//, '');
    if (parsed.body.trim()) entries.push({ file: rootRelative, posicion: indice + 1, ...parsed });
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
      return posix(relative(outDir, memberMarkdownPath(p.memberSlugs, outputDir, f)));
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

function entryHeadings(e: CollectionEntry): { creator: string; title: string } {
  return {
    creator: e.creator.length > 0 ? e.creator.join(', ') : AUTORA_POR_DEFECTO,
    title: e.title || TITULO_POR_DEFECTO,
  };
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
    const { creator, title } = entryHeadings(e);
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
    const { creator, title } = entryHeadings(e);
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
    const html = posix(join(dirname(e.file), `${htmlSlugFor(e.file, slug)}.html`));
    hrefs.set(e.file, relativeHref(dir, html));
  }
  return hrefs;
}

function printableEntries<T extends { type: string | undefined }>(entries: T[]): T[] {
  return entries.filter((e) => e.type !== 'intervention');
}

/**
 * De cada nombre de autora, la página de su documento `type: creator` (si lo
 * hay). El criterio es el mismo que usa la sección "Autoras y colaboradoras":
 * el `name` (o el `title`) del creator tiene que coincidir con el nombre.
 */
export function creatorHrefs(discoveryIndex: Map<string, DiscoveryEntry>, fromDir: string): Map<string, string> {
  const hrefs = new Map<string, string>();
  for (const [ruta, entry] of discoveryIndex) {
    if (entry.type !== 'creator') continue;
    const nombre = entry.fm?.name ?? entry.fm?.title;
    if (typeof nombre !== 'string' || nombre.trim() === '') continue;
    if (hrefs.has(nombre)) continue;
    const html = join(dirname(ruta), `${htmlSlugFor(ruta, entry.slug)}.html`)
      .split(sep)
      .join('/');
    hrefs.set(nombre, relativeHref(fromDir, html));
  }
  return hrefs;
}

function escapeMarkdown(texto: string): string {
  return texto.replace(/([[\]])/g, '\\$1');
}

/** El nombre tal como va en el metadato: con enlace si hay creator. */
export function nombresEnlazados(nombres: string[], hrefs: Map<string, string>): string[] {
  return nombres.map((nombre) => {
    const href = hrefs.get(nombre);
    if (href === undefined) return nombre;
    return `[${escapeMarkdown(nombre)}](<${href}>)`;
  });
}

/** El nombre tal como va dentro de una tarjeta: HTML. */
function nombreEnlazadoHtml(nombre: string, hrefs: Map<string, string>, tono: 'accent' | 'gris' = 'accent'): string {
  const href = hrefs.get(nombre);
  if (href === undefined) return nombre;
  const clases =
    tono === 'gris'
      ? 'text-stone-600 underline underline-offset-4 decoration-current/40 transition-colors duration-200 hover:decoration-current dark:text-stone-400'
      : 'text-accent-700 underline underline-offset-4 decoration-current/40 transition-colors duration-200 hover:decoration-current dark:text-accent-300';
  return `<a href="${href}" class="${clases}">${nombre}</a>`;
}

function collectionCards(
  entries: CollectionEntry[],
  memberHrefs: Map<string, string>,
  intro: string,
  desde: number,
  hasta: number,
  creatorHrefs: Map<string, string>,
  dir: string,
): string {
  const cards: string[] = [];
  if (intro !== '') cards.push([':::: {class="collection-intro"}', '', intro, '', '::::'].join('\n'));
  for (const e of printableEntries(entries).slice(desde, hasta)) {
    cards.push(collectionCard(e, memberHrefs.get(e.file), creatorHrefs, dir));
  }
  return cards.join('\n\n');
}

export function collectionCardsContent(
  entries: CollectionEntry[],
  memberHrefs: Map<string, string>,
  content: string,
  creatorHrefs: Map<string, string> = new Map(),
  dir = '.',
): string {
  if (entries.length === 0) return content;
  return collectionCards(entries, memberHrefs, splitFrontmatter(content).body.trim(), 0, Number.POSITIVE_INFINITY, creatorHrefs, dir);
}

/**
 * Reparte las tarjetas de la colección en páginas. La primera lleva el cuerpo
 * propio de la colección; el resto, sólo sus tarjetas.
 */
export function collectionCardsPages(
  entries: CollectionEntry[],
  memberHrefs: Map<string, string>,
  content: string,
  pageSize: number,
  creatorHrefs: Map<string, string> = new Map(),
  dir = '.',
): string[] {
  if (entries.length === 0) return [content];
  const imprimibles = printableEntries(entries);
  const intro = splitFrontmatter(content).body.trim();
  const paginas: string[] = [];
  for (let desde = 0; desde < imprimibles.length; desde += pageSize) {
    paginas.push(collectionCards(entries, memberHrefs, desde === 0 ? intro : '', desde, desde + pageSize, creatorHrefs, dir));
  }
  return paginas.length > 0 ? paginas : [content];
}

export function collectionScanContent(entries: CollectionEntry[], content: string): string {
  if (entries.length === 0) return content;
  const body = splitFrontmatter(content).body;
  const sections = collectionBaseContent(entries, 'latex', content);
  return body.trim() === '' ? sections : `${sections}\n\n${body}`;
}

const PAGINATION_BUTTON_CLASSES =
  'scroll-reveal-at-end pointer-events-auto flex h-12 items-center justify-center gap-2 rounded-full border border-accent-500/70 bg-accent-500/35 px-4 text-accent-900 shadow-lg shadow-accent-500/25 transition-colors duration-200 hover:border-accent-500 hover:bg-accent-500/45 dark:border-accent-500/70 dark:bg-accent-500/25 dark:text-accent-300 dark:hover:border-accent-500 dark:hover:bg-accent-500/35';

const PAGINATION_NAV_CLASSES = 'pointer-events-none fixed inset-x-0 bottom-6 z-50';

function pageSlug(outSlug: string, pagina: number): string {
  return pagina === 1 ? outSlug : `${outSlug}-${pagina}`;
}

/**
 * Los botones de paginación, flotantes junto al de «volver al principio»: el
 * anterior a su izquierda y el siguiente a su derecha. Se esconden hasta que
 * el scroll llega al final de la página.
 */
export function paginationNav(dir: string, outSlug: string, pagina: number, total: number): string {
  if (total <= 1) return '';
  const enlace = (n: number, texto: string, posicion: string): string =>
    `<a href="${relativeHref(dir, `${pageSlug(outSlug, n)}.html`)}" class="${PAGINATION_BUTTON_CLASSES} fixed bottom-6 left-1/2 ${posicion}" aria-label="${texto}">${texto}</a>`;
  const anterior = pagina > 1 ? enlace(pagina - 1, '← Anterior', '-translate-x-[calc(100%_+_2rem)]') : '';
  const siguiente = pagina < total ? enlace(pagina + 1, 'Siguiente →', 'translate-x-[2rem]') : '';
  return `<nav class="${PAGINATION_NAV_CLASSES}">${anterior}${siguiente}</nav>`;
}

function assertPaginasLibres(relativePath: string, dir: string, outSlug: string, total: number, discoveryIndex: Map<string, DiscoveryEntry>): void {
  for (let n = 2; n <= total; n++) {
    const nombre = pageSlug(outSlug, n);
    const dueno = htmlOwner(discoveryIndex, dir, nombre);
    if (dueno === undefined) continue;
    throw new BuildError(
      `"${relativePath}" se pagina en ${total} páginas y la página ${n} se llamaría "${nombre}.html", que es el archivo de "${dueno}". Dos documentos no pueden escribir el mismo archivo: fija otro "slug:" en el frontmatter de "${dueno}".`,
    );
  }
}

const MASONRY_WRAPPER = '<div class="break-inside-avoid pb-6">';

const CARD_TEXT_CLASSES =
  'prose prose-lg dark:prose-invert max-w-none [--tw-prose-links:var(--color-accent-700)] [--tw-prose-invert-links:var(--color-accent-300)]';

const COLLECTION_CARD_CLASSES = `tarjeta-fragmento relative rounded-tr-xl rounded-bl-xl tarjeta p-6 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 [overflow-wrap:anywhere] ${CARD_TEXT_CLASSES}`;

const PILL_BASE =
  'inline-block align-top rounded-full border border-accent-500/30 bg-accent-500/12 px-3 py-1 font-normal uppercase tracking-wide text-xs leading-none text-accent-800 dark:text-accent-300';

const MEMBER_PILL_CLASSES = `${PILL_BASE} mt-0 mb-6`;

// En las tarjetas extras el chip no deja espacio ni arriba ni abajo: es el
// primero de la tarjeta y el h2 traería sus márgenes del navegador.
const EXTRA_PILL_CLASSES = `${PILL_BASE} mt-0 mb-0`;

const MEMBER_BADGE_CLASSES =
  'inline-block shrink-0 rounded-full border border-stone-300 bg-stone-200/70 px-2 py-1 font-semibold text-xs leading-none mt-0 text-stone-600 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-300';

const MEMBER_TYPE_LABEL: Record<string, string> = { file: 'Texto', creator: 'Creadora' };

const CHIP_LINK_CLASSES = 'text-inherit no-underline transition-colors duration-200 hover:underline';

/** El chip de tipo, con enlace a la lista por defecto de ese type. */
function chipHtml(label: string, type: string | undefined, dir: string, classes = MEMBER_PILL_CLASSES): string {
  const href = defaultListHref(dir, type);
  const chip = `<h2 class="${classes}">${label}</h2>`;
  if (href === undefined) return chip;
  return `<h2 class="${classes}"><a href="${href}" class="${CHIP_LINK_CLASSES}">${label}</a></h2>`;
}

const MEMBER_LINK_CLASSES = 'underline underline-offset-4 decoration-current/40 transition-colors duration-200 hover:decoration-current';

const EXTRA_CARD_CLASSES = `tarjeta-extras relative rounded-tr-xl rounded-bl-xl tarjeta p-6 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 [overflow-wrap:anywhere] ${CARD_TEXT_CLASSES}`;

/** La tarjeta con la biografía de una creadora. */
export function creatorCard(doc: CreatorDoc, dir: string, creatorHrefs: Map<string, string>): string {
  return [
    `:::: {class="${EXTRA_CARD_CLASSES}"}`,
    '',
    chipHtml('Creadora', 'creator', dir, EXTRA_PILL_CLASSES),
    '',
    `<h2 class="text-center text-xl uppercase tracking-wide">${nombreEnlazadoHtml(doc.name, creatorHrefs)}</h2>`,
    '',
    doc.body.trim(),
    '',
    '::::',
  ].join('\n');
}

/**
 * La tarjeta con las colecciones y listas donde vive un documento. En vez de
 * un título, lleva un chip por cada tipo: Colecciones y Listas.
 */
export function containersCard(contenedores: { titulo: string; href: string; type: string | undefined }[], dir: string): string {
  const chips: string[] = [];
  if (contenedores.some((c) => c.type === 'collection')) chips.push(chipHtml('Colecciones', 'collection', dir, EXTRA_PILL_CLASSES));
  if (contenedores.some((c) => c.type === 'list')) chips.push(chipHtml('Listas', 'list', dir, EXTRA_PILL_CLASSES));
  const items = contenedores.map((c) => `- [${c.titulo}](${c.href})`).join('\n');
  return [
    `:::: {class="${EXTRA_CARD_CLASSES}"}`,
    '',
    `<div class="flex flex-wrap items-center gap-2">${chips.join('')}</div>`,
    '',
    items,
    '',
    '::::',
  ].join('\n');
}

/** La tarjeta con los textos donde aparece una creadora. */
export function creatorTextsCard(textos: { titulo: string; href: string }[], dir: string): string {
  const items = textos.map((t) => `- [${t.titulo}](${t.href})`).join('\n');
  return [`:::: {class="${EXTRA_CARD_CLASSES}"}`, '', chipHtml('Textos', 'file', dir, EXTRA_PILL_CLASSES), '', items, '', '::::'].join('\n');
}

/**
 * Las tarjetas que van después del texto: la biografía de cada creadora y las
 * colecciones donde vive el documento.
 *
 * Los bios son Markdown, así que se convierten aparte: si entraran en el
 * cuerpo del documento quedarían dentro de su tarjeta.
 */
async function buildExtrasHtml(args: {
  creatorDocs: CreatorDoc[];
  contenedores: { titulo: string; href: string; type: string | undefined }[];
  textos: { titulo: string; href: string }[];
  creatorHrefs: Map<string, string>;
  filters: ExportContext['filters'];
  imagePaths?: string;
  sourcePath: string;
  dir: string;
}): Promise<string> {
  const partes: string[] = [];
  // Los textos donde aparece la creadora van primero: es lo que la identifica.
  if (args.textos.length > 0) {
    partes.push([MASONRY_WRAPPER, '', creatorTextsCard(args.textos, args.dir), '', '</div>'].join('\n'));
  }
  // Cada tarjeta va en su propia celda del masonry, con su separación.
  for (const doc of args.creatorDocs) {
    partes.push([MASONRY_WRAPPER, '', creatorCard(doc, args.dir, args.creatorHrefs), '', '</div>'].join('\n'));
  }
  // La tarjeta "También está en" se muestra si el texto vive en al menos una
  // colección real. No se crea si no pertenece a ninguna colección o sólo a
  // las listas por defecto (que nunca aparecen aquí).
  if (args.contenedores.some((c) => c.type === 'collection')) {
    partes.push([MASONRY_WRAPPER, '', containersCard(args.contenedores, args.dir), '', '</div>'].join('\n'));
  }
  if (partes.length === 0) return '';

  const extraArgs = ['--shift-heading-level-by=4'];
  for (const f of [...args.filters.semantic, ...args.filters.user, ...args.filters.flags, ...args.filters.html]) {
    extraArgs.push('--lua-filter', f);
  }
  const html = await execPandoc({
    input: partes.join('\n\n'),
    sourcePath: args.sourcePath,
    from: MD_READER,
    to: 'html5',
    extraArgs,
    env: imagePathsEnv(args.imagePaths),
  });
  return minifyHtml(html);
}

function collectionCard(e: CollectionEntry, href: string | undefined, creatorHrefs: Map<string, string>, dir: string): string {
  // Un type creator no tiene creator: su tarjeta muestra el name y nada más.
  const tonoCreator = (e.type ?? 'file') === 'file' ? 'gris' : 'accent';
  const creator =
    e.type === 'creator'
      ? ''
      : e.creator.length > 0
        ? e.creator.map((n) => `<span class="whitespace-nowrap">${nombreEnlazadoHtml(n, creatorHrefs, tonoCreator)}</span>`).join(', ')
        : AUTORA_POR_DEFECTO;
  const title = e.title || TITULO_POR_DEFECTO;
  const fragment = extractFragment(e.body);

  const card = [`:::: {class="${COLLECTION_CARD_CLASSES}"}`, ''];
  const typeLabel = MEMBER_TYPE_LABEL[e.type ?? 'file'];
  if (typeLabel !== undefined) {
    card.push(
      `<div class="flex items-start justify-between gap-4">${chipHtml(typeLabel, e.type, dir)}<span class="${MEMBER_BADGE_CLASSES}">${e.posicion}</span></div>`,
      '',
    );
  }
  if (creator !== '') {
    card.push(`<h2 class="text-center text-base">${creator}</h2>`, '');
  }
  const tituloHref = href;
  card.push(
    tituloHref === undefined
      ? `<h3 class="text-center text-[22px] font-bold text-accent-900 dark:text-accent-300 mb-6">${title}</h3>`
      : `<h3 class="text-center text-[22px] font-bold text-accent-900 dark:text-accent-300 mb-6"><a href="${tituloHref}" class="${MEMBER_LINK_CLASSES}">${title}</a></h3>`,
  );
  if (e.subtitle) card.push('', `<h4 class="text-center text-lg italic tracking-wide mb-4">${e.subtitle}</h4>`);
  if (fragment !== '') card.push('', fragment);
  if (href !== undefined) {
    card.push('', `<p class="text-center mt-4"><a href="${href}" class="${MEMBER_LINK_CLASSES}">Leer el texto completo →</a></p>`);
  }
  card.push('', '::::');
  return [MASONRY_WRAPPER, '', ...card, '', '</div>'].join('\n');
}

function buildCollectionSectionsMarkdown(entries: CollectionEntry[]): string {
  return buildCollectionSections(entries, MARKDOWN_HEADINGS);
}

function resolveCollectionContent(
  collectionEntries: CollectionEntry[],
  format: 'latex' | 'html' | 'markdown',
  fallback: string,
  pageNumber?: string,
): string {
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

function prependLinksMarkdown(content: string, links: { name: string; url: string }[]): string {
  if (links.length === 0) return content;
  const { yaml, body } = splitFrontmatter(content);
  const md = creatorLinksInlineMd(links);

  if (body.trimStart().startsWith(md)) return content;
  const prefix = yaml !== undefined ? `---\n${yaml}\n---\n` : '';
  return `${prefix}${md}\n\n${body.trimEnd()}`;
}

function prependLinksLatex(content: string, links: { name: string; url: string }[]): string {
  if (links.length === 0) return content;
  const { yaml, body } = splitFrontmatter(content);

  if (body.trimStart().startsWith(creatorLinksInlineMd(links))) return content;
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

export function creatorDocPathsFor(nombres: string[], discoveryIndex: Map<string, DiscoveryEntry>): string[] {
  const wanted = new Set(nombres);
  const paths: string[] = [];
  for (const [ruta, entry] of discoveryIndex) {
    if (entry.type !== 'creator') continue;
    const nombre = entry.fm?.name ?? entry.fm?.title;
    if (typeof nombre !== 'string' || !wanted.has(nombre)) continue;
    paths.push(ruta);
  }
  return paths;
}

/** Los documentos de creator que corresponden a los nombres de un documento. */
export async function resolveCreatorDocs(
  nombres: string[],
  discoveryIndex: Map<string, DiscoveryEntry>,
  cwd: string,
  label: string,
): Promise<CreatorDoc[]> {
  const docs: CreatorDoc[] = [];
  for (const ruta of creatorDocPathsFor(nombres, discoveryIndex)) {
    docs.push(await resolveSingleCreatorDoc(ruta, cwd, label));
  }
  return docs;
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
    const { value, error } = parseYamlWithPosition(yaml);
    if (error) {
      logWarning(`no se pudo leer el frontmatter de "${file}": ${error}`, 'build');
      continue;
    }
    const parsed = value as Record<string, unknown> | undefined;
    extractCreatorNames(parsed?.creator, names);
    extractCreatorNames(parsed?.contributor, names);
  }
  return names;
}

function extractCreatorNames(raw: unknown, target: Set<string>): void {
  for (const name of parseAuthors(raw)) target.add(name);
}

async function resolveSingleCreatorDoc(relativePath: string, cwd: string, label: string): Promise<CreatorDoc> {
  const filePath = join(cwd, relativePath);
  let text: string;
  try {
    text = await Bun.file(filePath).text();
  } catch {
    throw new BuildError(`${label}: archivo de creator no encontrado: "${relativePath}"`);
  }
  const { yaml, body } = splitFrontmatter(text);
  let name = '';
  let links: { name: string; url: string }[] = [];
  if (yaml) {
    const { value, error } = parseYamlWithPosition(yaml);
    if (error) throw new BuildError(`${label}: frontmatter inválido en "${relativePath}": ${error}`);
    const parsed = value as Record<string, unknown> | undefined;
    name = typeof parsed?.name === 'string' && parsed.name ? parsed.name : typeof parsed?.title === 'string' ? parsed.title : '';
    links = parsed ? getCreatorLinks(parsed) : [];
  }
  if (!body.trim()) {
    throw new BuildError(`${label}: creator "${name}" debe tener body (contenido después del frontmatter)`);
  }
  return { name, body, relativePath, links };
}

export async function collectionCreatorDocPaths(
  files: string[] | undefined,
  collectionFm: Record<string, unknown>,
  discoveryIndex: Map<string, DiscoveryEntry>,
  cwd: string,
): Promise<string[]> {
  if (!files || files.length === 0) return [];

  const creatorNames = await collectCreatorNamesFromFiles(files, cwd);
  extractCreatorNames(collectionFm.contributor, creatorNames);
  if (creatorNames.size === 0) return [];

  const paths: string[] = [];
  for (const [relativePath, entry] of discoveryIndex.entries()) {
    if (entry.type !== 'creator') continue;
    const name = (entry.fm?.name ?? entry.fm?.title ?? '') as string;
    if (!name || !creatorNames.has(name)) continue;
    paths.push(relativePath);
  }
  return paths;
}

export async function resolveCollectionCreatorDocs(
  doc: BuildDocument,
  discoveryIndex: Map<string, DiscoveryEntry>,
  cwd: string,
  collectionFm: Record<string, unknown>,
): Promise<CreatorDoc[]> {
  const paths = await collectionCreatorDocPaths(doc.frontmatter.files, collectionFm, discoveryIndex, cwd);
  const result: CreatorDoc[] = [];
  for (const relativePath of paths) {
    result.push(await resolveSingleCreatorDoc(relativePath, cwd, doc.relativePath));
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function buildAuthorsLatex(
  creatorDocs: CreatorDoc[],
  sourcePath: string,
  filters: ExportContext['filters'],
  esFile: boolean,
  numCreadoras: number,
): Promise<string> {
  if (creatorDocs.length === 0) return '';
  // El nombre de cada creadora va centrado en el texto suelto; en la
  // colección se mantiene a la izquierda, como estaba.
  const alineacion = esFile ? '\\centering' : '\\raggedright';
  const subsubsectionStyle = `\\RedeclareSectionCommand[beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}\n\\setkomafont{subsubsection}{${alineacion}\\normalsize\\normalfont\\scshape}`;
  const subsubsectionReset =
    '\\RedeclareSectionCommand[beforeskip=\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}\n\\setkomafont{subsubsection}{\\normalsize\\normalfont\\bfseries}';
  // En un texto suelto la sección de autoras es una sección más; en una
  // colección es una parte, porque el documento reúne muchas pieces.
  const nivel = esFile ? 'section' : 'part';
  const md: string[] = [];
  // Con una sola creadora el encabezado «Autoras y colaboradoras» sobra: su
  // nombre y su bio se quedan, pero sin el título de sección.
  if (!(esFile && numCreadoras < 2)) {
    md.push(`\\${nivel}{Autoras y colaboradoras}`);
  }
  md.push(subsubsectionStyle);
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

/** Los nombres de las autoras de un documento: su creator y sus contributors. */
export function nombresDeAutora(doc: BuildDocument, fm: Record<string, unknown>): string[] {
  return [...doc.frontmatter.creator, ...parseAuthors(fm.contributor)];
}

/** Las colecciones y listas donde vive un documento, con su enlace. */
function contenedoresDe(
  doc: BuildDocument,
  dir: string,
  discoveryIndex: Map<string, DiscoveryEntry>,
): { titulo: string; href: string; type: string | undefined }[] {
  const entry = discoveryIndex.get(doc.relativePath);
  const rutas = entry?.containedBy ?? [];
  return rutas.map((ruta) => {
    const contenedor = discoveryIndex.get(ruta);
    const html = join(dirname(ruta), `${htmlSlugFor(ruta, contenedor?.slug)}.html`)
      .split(sep)
      .join('/');
    return { titulo: contenedor?.title || ruta, href: relativeHref(dir, html), type: contenedor?.type };
  });
}

/** Los textos donde aparece la creadora del documento, si el documento es una creadora. */
function textosDeLaCreadoraDelDoc(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  discoveryIndex: Map<string, DiscoveryEntry>,
): { titulo: string; href: string }[] {
  if (doc.frontmatter.type !== 'creator') return [];
  return textosDeCreadora(String(outputs.fm.name ?? outputs.fm.title ?? ''), outputs.dir, discoveryIndex);
}

/**
 * Los textos donde aparece una creadora: como creator o como collectionCreator.
 * El criterio de coincidencia es el mismo que usa la sección de autoras.
 */
function textosDeCreadora(nombre: string, dir: string, discoveryIndex: Map<string, DiscoveryEntry>): { titulo: string; href: string }[] {
  if (nombre === '') return [];
  const textos: { titulo: string; href: string }[] = [];
  for (const [ruta, entry] of discoveryIndex.entries()) {
    if (entry.type !== undefined && entry.type !== 'file') continue;
    const autores = [...entry.creator, ...parseAuthors(entry.fm?.collectionCreator)];
    if (!autores.includes(nombre)) continue;
    const html = join(dirname(ruta), `${htmlSlugFor(ruta, entry.slug)}.html`)
      .split(sep)
      .join('/');
    textos.push({ titulo: entry.title || ruta, href: relativeHref(dir, html) });
  }
  return textos.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
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

  const esFile = doc.frontmatter.type === undefined || doc.frontmatter.type === 'file';
  const nombresCreadoras = nombresDeAutora(doc, outputs.fm);
  const creatorDocs = esFile ? await resolveCreatorDocs(nombresCreadoras, discoveryIndex, ctx.cwd, `"${doc.relativePath}"`) : [];

  const images = await preprocessDocumentImages(
    [collectionScanContent(collectionEntries, content), ...creatorDocs.map((c) => c.body)].join('\n\n'),
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

  if (
    (activeFormats.latex || activeFormats.pdf) &&
    formatWorkSets.latexPaths.has(doc.relativePath) &&
    docProducesFormat(doc.frontmatter.type, 'latex')
  ) {
    const pageNumber = (outputs.fm.pageNumber ?? formatCfg?.pdf?.pageNumber ?? ctx.siteConfig.pageNumber) as string | undefined;
    const base = collectionBaseContent(collectionEntries, 'latex', content, pageNumber);
    const docsAutoras = isCollection ? await resolveCollectionCreatorDocs(doc, discoveryIndex, ctx.cwd, outputs.fm) : creatorDocs;
    const authorsBlock = await buildAuthorsLatex(docsAutoras, doc.filePath, exportCtx.filters, esFile, nombresCreadoras.length);
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

  const exportDoc = assembleExportDocument(doc, renderCtx.lang, exportCtx.globalBibliography, exportCtx.globalCsl);

  if (activeFormats.html && formatWorkSets.htmlPaths.has(doc.relativePath) && docProducesFormat(doc.frontmatter.type, 'html')) {
    const memberHrefs = memberHtmlHrefs(doc.relativePath, collectionEntries, discoveryIndex);
    const hrefsCreadores = creatorHrefs(discoveryIndex, outputs.dir);
    const pageSize = formatCfg?.html?.pageSize ?? DEFAULT_HTML_FORMAT.pageSize;
    const paginas = collectionCardsPages(collectionEntries, memberHrefs, content, pageSize, hrefsCreadores, outputs.dir);
    assertPaginasLibres(doc.relativePath, outputs.dir, outputs.outSlug, paginas.length, discoveryIndex);

    const imagePaths = await writeImagePaths(doc, ctx.cwd, 'html', images.imageMap, docDir, true);
    const extras = await buildExtrasHtml({
      creatorDocs,
      contenedores: contenedoresDe(doc, outputs.dir, discoveryIndex),
      textos: textosDeLaCreadoraDelDoc(doc, outputs, discoveryIndex),
      creatorHrefs: hrefsCreadores,
      filters: exportCtx.filters,
      imagePaths,
      sourcePath: doc.filePath,
      dir: outputs.dir,
    });
    const contenidos = paginas.map((base) => prependLinksMarkdown(base, creatorLinks));

    await emitHtmlPage(doc, outputs, renderCtx, exportCtx, discoveryIndex, imagePaths, contenidos, hrefsCreadores, extras);
    await removeExtraHtmlPages(ctx.outputDir, outputs.dir, outputs.outSlug, paginas.length, discoveryIndex);
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
  if (!docProducesFormat(doc.frontmatter.type, 'markdown')) return;

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

function miembrosDeUnType(discoveryIndex: Map<string, DiscoveryEntry>, type: string): string[] {
  const miembros: string[] = [];
  for (const [ruta, entry] of discoveryIndex) {
    if ((entry.type ?? 'file') === type) miembros.push(ruta);
  }
  return miembros;
}

function imagenesDeLosFragmentos(entradas: CollectionEntry[], cwd: string): string[] {
  const imagenes: string[] = [];
  for (const entrada of entradas) {
    const fragmento = extractFragment(entrada.body);
    if (fragmento === '') continue;
    imagenes.push(...scanInlineImages(fragmento, dirname(join(cwd, entrada.file))));
  }
  return imagenes;
}

/**
 * Las listas por defecto: una página por type, con los documentos de ese type
 * como tarjetas. Se escriben en la raíz de la salida, sin archivo fuente.
 */
export async function emitDefaultLists(args: {
  cwd: string;
  outputDir: string;
  renderCtx: RenderContext;
  exportCtx: ExportContext;
  discoveryIndex: Map<string, DiscoveryEntry>;
}): Promise<void> {
  const { cwd, outputDir, renderCtx, exportCtx, discoveryIndex } = args;
  const { plan, formatCfg } = renderCtx;
  if (!plan.activeFormats.html) return;

  const pageSize = formatCfg?.html?.pageSize ?? DEFAULT_HTML_FORMAT.pageSize;
  const hrefsCreadores = creatorHrefs(discoveryIndex, '.');

  const listas = [];
  for (const lista of DEFAULT_LISTS) {
    const miembros = miembrosDeUnType(discoveryIndex, lista.type);
    const entradas = await readCollectionEntries(miembros, `${lista.slug}.md`, [cwd]);
    listas.push({ ...lista, miembros, entradas });
  }

  const dimensiones = renderCtx.pageDimensions ?? detectPageSize([]);
  const procesadas = await processDocumentImages(
    imagenesDeLosFragmentos(
      listas.flatMap((l) => l.entradas),
      cwd,
    ),
    {},
    cwd,
    dimensiones,
    renderCtx.cropActive,
    join(outputDir, ASSETS_IMAGES_DIR),
    imageNamerFor('lista'),
    undefined,
    renderCtx.pdfxActive,
  );

  for (const { slug, title, type, miembros, entradas } of listas) {
    const dueno = htmlOwner(discoveryIndex, '.', slug);
    if (dueno !== undefined) {
      logWarning(
        `no se escribió la lista de ${type} porque "${slug}.html" es el archivo de "${dueno}": renombra ese documento (con "slug:" en su frontmatter) para que la lista exista`,
        'build',
      );
      continue;
    }

    const memberHrefs = memberHtmlHrefs(`${slug}.md`, entradas, discoveryIndex);
    const paginas = collectionCardsPages(entradas, memberHrefs, '', pageSize, hrefsCreadores, '.');
    const contenidos = paginas.map((base, indice) => base + paginationNav('.', slug, indice + 1, paginas.length));

    const doc: BuildDocument = {
      filePath: join(cwd, `${slug}.md`),
      relativePath: `${slug}.md`,
      frontmatter: { title, date: '', creator: [], type: 'list', files: miembros },
    };
    const outputs: DocumentOutputs = {
      slug,
      outSlug: slug,
      dir: '.',
      fm: { title, type: 'list' },
      content: '',
      outBase: (name: string): string => join(outputDir, name),
    };

    const imagePaths = await writeListImagePaths(cwd, slug, procesadas.imageMap);
    await emitHtmlPage(doc, outputs, renderCtx, exportCtx, discoveryIndex, imagePaths, contenidos, hrefsCreadores);
  }
}

/**
 * El archivo de rutas de imágenes de una lista por defecto. No usa el nombre
 * del documento (que no existe) para no pisar el de un documento de verdad.
 */
async function writeListImagePaths(cwd: string, slug: string, imageMap: Map<string, string>): Promise<string> {
  const path = join(cwd, '.iteraciones', 'paths', `_lista-${slug}.html.json`);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(imagePathsMap(imageMap, cwd, true))}\n`);
  return path;
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
  const isList = doc.frontmatter.type === 'list';
  if (isCollection && entry?.aggregatedCreator) {
    doc.frontmatter.creator = entry.aggregatedCreator;
    entry.fm = { ...entry.fm, creator: entry.aggregatedCreator };
  }
  const collectionEntries = isCollection || isList ? await readCollectionFiles(doc, ctx.cwd) : [];
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
