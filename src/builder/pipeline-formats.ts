import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_FORMAT } from '../config/site-config.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, fmTrimmedString, resolveBooleanField, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { minifyHtml } from '../lib/minify.js';
import { execPandoc, imagePathsEnv, MD_READER } from '../lib/pandoc-runner.js';
import { posix } from '../lib/paths.js';
import { isScriptCapture, recordSupportCommand, resolveScriptStdout } from '../lib/script-recorder.js';
import type { LogoAsset } from './build-assets.js';
import { htmlOwner, removeExtraHtmlPages } from './cleanup.js';
import { extractFragment } from './collection-fragment.js';
import { DEFAULT_LISTS, defaultListHref, defaultListSlug } from './default-lists.js';
import { computeSlug, htmlSlugFor } from './discover.js';
import { parseAuthors } from './discover-frontmatter.js';
import { assembleExportDocument, convertToEpub, convertToMarkdown, type ExportDocument } from './export.js';
import { MBOX_HELPERS_FILTER } from './filter-resolver.js';
import { CHIP_OUTLINE_CLASSES, type HtmlDocType, type HtmlPageVars, logoBlockHtml } from './html-composer.js';
import {
  type DocumentImages,
  imageNamerFor,
  imagePathsMap,
  type ProcessedImages,
  preprocessDocumentImages,
  processWebImages,
  relImageMapFor,
  rewriteFmImagePaths,
  rewriteImagePaths,
  scanInlineImages,
} from './image-processor.js';
import { keywordHref, keywordListsOf, keywordMembers, keywordSlug, keywordsFromFm, keywordsOf } from './keyword-lists.js';
import {
  buildTexDistribution,
  composeLatexFinalOutput,
  insertAuthorsBlock,
  type LatexPostManifest,
  markdownToLatex,
  mergeConfigImages,
  removeEmptyToc,
} from './latex-composer.js';
import { detectPageSize } from './latex-preamble.js';
import {
  ASSETS_CSS_FILE,
  ASSETS_IMAGES_DIR,
  ASSETS_PDF_IMAGES_DIR,
  docProducesFormat,
  KEYWORDS_DIR,
  primaryOutputExtension,
} from './output-layout.js';
import { espaciosNormales, formatLinksFor, parseFileFrontmatter, readMarkdownOrWarn, relativeHref, writeOutput } from './pipeline-io.js';
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
  if (type === 'creator') return 'Colaboradora';
  if (type === 'list') return 'Lista';
  if (type === 'menu') return 'Menú';
  if (type === 'announcement') return 'Anuncio';
  if (type === 'all') return 'Publicaciones';
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
  images: ProcessedImages,
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
    images: { imageMap: images.imageMap, processedImages: images.processedFiles },
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

/** La URL en el HTML de las portadas, ya procesadas en su versión web. */
function htmlCoverUrls(fm: Record<string, unknown>, docDir: string, webMap: Map<string, string>): { front?: string; back?: string } {
  const covers: { front?: string; back?: string } = {};
  for (const [field, key] of [
    ['frontCover', 'front'],
    ['backCover', 'back'],
  ] as const) {
    const raw = fm[field];
    if (typeof raw !== 'string' || raw === '') continue;
    const abs = isAbsolute(raw) ? raw : resolve(docDir, raw);
    const processed = webMap.get(abs);
    if (processed === undefined || processed === abs) continue;
    covers[key] = `./${ASSETS_IMAGES_DIR}/${basename(processed)}`;
  }
  return covers;
}

/** La ruta de la portada para el cover del EPUB, ya procesada en su versión EPUB. */
function epubCoverPath(fm: Record<string, unknown>, docDir: string, epubMap: Map<string, string>): string | undefined {
  const raw = fm.frontCover;
  if (typeof raw !== 'string' || raw === '') return undefined;
  const abs = isAbsolute(raw) ? raw : resolve(docDir, raw);
  const processed = epubMap.get(abs);
  return processed !== undefined && processed !== abs ? processed : undefined;
}

function contentChipPara(type: string | undefined): string | undefined {
  if (type === 'creator') return 'Bio';
  if (type === undefined || type === 'file') return 'Contenido';
  return undefined;
}

function docChipHrefPara(dir: string, type: string | undefined, available?: Set<string>): string | undefined {
  const slug = defaultListSlug(type);
  if (slug === undefined) return undefined;
  if (available !== undefined && !available.has(slug)) return undefined;
  return defaultListHref(dir, type);
}

/** El logo y el favicon, con rutas relativas al nivel de la página. */
function logoVars(logo: LogoAsset | undefined, dir: string, logoSize: string | undefined): Pick<HtmlPageVars, 'logoBlock' | 'favicon'> {
  if (logo === undefined) return {};
  const href = logo.kind === 'file' ? relativeHref(dir, logo.path) : '';
  return {
    logoBlock: logoBlockHtml(logo, href, logoSize),
    favicon: logo.favicon === undefined ? undefined : `<link rel="icon" href="${relativeHref(dir, logo.favicon)}">`,
  };
}

/** Las tarjetas site-wide que dependen de la página: menú, anuncios y licencia. */
function tarjetasDeSitio(args: {
  siteConfig: SiteConfig;
  dir: string;
  menu?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
}): Pick<HtmlPageVars, 'license' | 'menu' | 'announcementsTop' | 'announcementsBottom'> {
  return {
    license: licenciaHtml(args.siteConfig, args.dir),
    menu: args.menu,
    announcementsTop: args.announcementsTop === '' ? undefined : args.announcementsTop,
    announcementsBottom: args.announcementsBottom === '' ? undefined : args.announcementsBottom,
  };
}

function htmlVars(args: {
  doc: BuildDocument;
  outputs: DocumentOutputs;
  renderCtx: RenderContext;
  formats: HtmlPageVars['formats'];
  hasHomePage: boolean;
  available?: Set<string>;
  docChip?: string;
  covers?: { front?: string; back?: string };
  creatorImage?: string;
  menu?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
  indiceColeccion?: string;
  creatorHrefs: Map<string, string>;
  extras: string;
  pagination: string;
}): HtmlPageVars {
  const {
    doc,
    outputs,
    renderCtx,
    formats,
    hasHomePage,
    available,
    docChip,
    covers,
    creatorImage,
    menu,
    announcementsTop,
    announcementsBottom,
    indiceColeccion,
    creatorHrefs,
    extras,
    pagination,
  } = args;
  const { ctx, lang, formatCfg } = renderCtx;
  const htmlConfig = formatCfg?.html;
  const { dir, slug, fm } = outputs;
  const titulo = doc.frontmatter.title || slug;
  return {
    ...logoVars(renderCtx.logo, dir, htmlConfig?.site?.logoSize),
    title: titulo,
    siteTitle: htmlConfig?.site?.title ?? 'iteraciones',
    tagline: htmlConfig?.site?.description ?? 'escribir, compartir, re-existir',
    lang,
    theme: htmlConfig?.site?.theme,
    css: ctx.needsCss ? relativeHref(dir, ASSETS_CSS_FILE) : undefined,
    keywords: keywordsFromFm(fm).join(', ') || undefined,
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
    docChip: docChip ?? docChipLabel(doc.frontmatter.type),
    contentChip: contentChipPara(doc.frontmatter.type),
    frontCover: covers?.front,
    backCover: covers?.back,
    creatorImage,
    creatorImageAlt: creatorImage === undefined ? undefined : `Retrato de ${titulo}`,
    ...tarjetasDeSitio({ siteConfig: ctx.siteConfig, dir, menu, announcementsTop, announcementsBottom }),
    indiceColeccion,
    docChipHref: docChipHrefPara(dir, doc.frontmatter.type, available),
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
  docChipOverride?: string,
  covers?: { front?: string; back?: string },
  indices?: string[],
  creatorImage?: string,
  menu?: string,
  announcementsTop?: string,
  announcementsBottom?: string,
): Promise<void> {
  const { ctx, plan } = renderCtx;
  const { dir, outBase, outSlug, content } = outputs;
  const cwd = ctx.cwd;

  const formats = formatLinksFor(plan, dir, outSlug, doc.frontmatter.type);
  const hasHomePage = discoveryIndex.has('index.md') || discoveryIndex.size > 0;
  const available = availableDefaultListSlugs(discoveryIndex);

  const htmlType: HtmlDocType =
    doc.frontmatter.type === 'collection' || doc.frontmatter.type === 'creator' || doc.frontmatter.type === 'list' ? doc.frontmatter.type : 'file';
  const contenidos = paginas ?? [content];
  for (const [indice, contenido] of contenidos.entries()) {
    const slugPagina = indice === 0 ? outSlug : `${outSlug}-${indice + 1}`;
    const htmlPath = outBase(`${slugPagina}${primaryOutputExtension('html')}`);
    const pagination = paginationNav(outSlug, indice + 1, contenidos.length);
    const html = await htmlPageFromMarkdown(contenido, doc, {
      cwd,
      inputTarget: await collectionPandocInput(doc, cwd, outSlug, 'html'),
      imagePaths,
      templatePath: exportCtx.templates[htmlKindFor(htmlType)],
      refsCardTemplate: exportCtx.refsCardTemplates[htmlType],
      docType: htmlType,
      vars: htmlVars({
        doc,
        outputs,
        renderCtx,
        formats,
        hasHomePage,
        available,
        docChip: docChipOverride,
        covers,
        creatorImage,
        menu,
        announcementsTop,
        announcementsBottom,
        indiceColeccion: indices?.[indice],
        creatorHrefs,
        extras,
        pagination,
      }),
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

  /** Las imágenes del membrete, ya resueltas contra el directorio del archivo. */
  letterhead?: string[];

  /** El directorio real del archivo miembro, para resolver sus imágenes. */
  dirAbs?: string;

  /** El retrato de una creadora, relativo a su archivo. */
  image?: string;
  body: string;
};

/** Lee el primero de los candidatos que exista y devuelve su directorio. */
async function readEntryText(candidates: string[], collectionPath: string, file: string): Promise<{ text: string; dir: string }> {
  for (const candidate of candidates) {
    try {
      return { text: await Bun.file(candidate).text(), dir: dirname(candidate) };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw new BuildError(`collection "${collectionPath}": no se pudo leer "${candidate}": ${(err as Error).message}`);
      }
    }
  }
  throw new BuildError(`collection "${collectionPath}": archivo configurado en files no encontrado: "${file}" (probado: ${candidates.join(', ')})`);
}

export async function readCollectionEntries(
  files: string[],
  collectionPath: string,
  bases: string[],
  incluirSinCuerpo = false,
): Promise<CollectionEntry[]> {
  const entries: CollectionEntry[] = [];
  for (const [indice, file] of files.entries()) {
    const candidates = [...new Set(bases.map((base) => join(base, file)))];
    const { text, dir } = await readEntryText(candidates, collectionPath, file);
    const parsed = parseFileFrontmatter(text, file);
    parsed.letterhead = parsed.letterhead.map((p) => (isAbsolute(p) ? p : resolve(dir, p)));

    const rootRelative = posix(file).replace(/^\.\//, '');
    if (incluirSinCuerpo || parsed.body.trim()) entries.push({ file: rootRelative, posicion: indice + 1, dirAbs: dir, ...parsed });
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

  /** Las creadoras de la colección, para la sección de colaboradoras. */
  autoras?: CreatorDoc[];
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
  const autoras = merge ? (p.autoras ?? []) : [];
  const seccionAutoras = buildAuthorsMarkdown(autoras);
  const base = espaciosNormales(
    merge
      ? [collectionBaseContent(p.entries, 'markdown', p.content, undefined, true), seccionAutoras].filter((t) => t !== '').join('\n\n')
      : p.content,
  );
  // Las redes de la creadora viajan en el frontmatter (`links:`), no repetidas
  // en el cuerpo: así el markdown re-procesado da el mismo HTML.
  await convertToMarkdown(rewriteImagePaths(base, p.relImageMap, p.docDir), outPath, p.exportDoc, mdFm, merge);
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

function buildCollectionEntryLatex(e: CollectionEntry, isHeader: boolean, membrete: string[] = []): string[] {
  const parts: string[] = [];
  if (e.type === 'intervention') {
    parts.push(interventionSectionRaw(e.lineLength));
    // El \chapter de arriba ya saltó de página: encender el membrete antes
    // pintaría también la página anterior, que se envía al hacer el salto.
    if (membrete.length > 0) parts.push(`\\letterheadsetup{${membrete.join(',')}}`);
    parts.push('\\thispagestyle{empty}');
    parts.push(e.body.trim());
    if (e.pages && e.pages > 0) {
      parts.push('\\thispagestyle{empty}\n\\null\\newpage\n'.repeat(e.pages).trim());
    }
    if (membrete.length > 0) parts.push('\\letterheadclear');
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

function buildCollectionSectionsLatex(entries: CollectionEntry[], pageNumber?: string, imageMap?: Map<string, string>): string {
  const isHeader = pageNumber?.startsWith('header-') ?? false;
  const parts: string[] = [];
  for (const e of entries) {
    const membrete = e.type === 'intervention' ? (e.letterhead ?? []).map((p) => imageMap?.get(p) ?? p) : [];
    parts.push(...buildCollectionEntryLatex(e, isHeader, membrete));
  }
  return parts.join('\n\n');
}

/** Las imágenes de membrete de las interventions de una colección. */
function collectionLetterheadFiles(entries: CollectionEntry[]): string[] {
  return entries.flatMap((e) => (e.type === 'intervention' ? (e.letterhead ?? []) : []));
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

function buildCollectionSections(entries: CollectionEntry[], headings: Headings, salto = 0): string {
  const parts: string[] = [];
  for (const e of entries) {
    const { creator, title } = entryHeadings(e);
    parts.push(`${headings[0][0]}${creator}${headings[0][1]}`);
    parts.push(`${headings[1][0]}${title}${headings[1][1]}`);
    if (e.subtitle) parts.push(`${headings[2][0]}${e.subtitle}${headings[2][1]}`);
    parts.push(salto === 0 ? e.body.trim() : desplazaEncabezados(e.body.trim(), salto));
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
function nombreEnlazadoHtml(nombre: string, hrefs: Map<string, string>, tono: 'accent' | 'gris' | 'plano' = 'accent'): string {
  const href = hrefs.get(nombre);
  if (href === undefined) return nombre;
  if (tono === 'plano') return `<a href="${href}">${nombre}</a>`;
  const clases =
    tono === 'gris'
      ? 'text-stone-600 no-underline underline-offset-4 hover:underline dark:text-stone-400'
      : 'text-accent-700 no-underline underline-offset-4 hover:underline dark:text-accent-300';
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
  available?: Set<string>,
  discoveryIndex?: Map<string, DiscoveryEntry>,
  page?: PageRef,
  currentHref?: string,
  imagenes?: Map<string, string>,
): string {
  const cards: string[] = [];
  if (intro !== '') cards.push([':::: {class="collection-intro"}', '', intro, '', '::::'].join('\n'));
  for (const e of printableEntries(entries).slice(desde, hasta)) {
    cards.push(collectionCard(e, memberHrefs.get(e.file), creatorHrefs, dir, available, discoveryIndex, page, currentHref, imagenes));
  }
  return espaciosNormales(cards.join('\n\n'));
}

export function collectionCardsContent(
  entries: CollectionEntry[],
  memberHrefs: Map<string, string>,
  content: string,
  creatorHrefs: Map<string, string> = new Map(),
  dir = '.',
  available?: Set<string>,
  discoveryIndex?: Map<string, DiscoveryEntry>,
  page?: PageRef,
  imagenes?: Map<string, string>,
): string {
  if (entries.length === 0) return content;
  // Las páginas de la colección son hermanas, aunque vivan en un subdirectorio.
  const href = page?.outSlug === undefined ? undefined : `./${page.outSlug}.html`;
  return collectionCards(
    entries,
    memberHrefs,
    splitFrontmatter(content).body.trim(),
    0,
    Number.POSITIVE_INFINITY,
    creatorHrefs,
    dir,
    available,
    discoveryIndex,
    page,
    href,
    imagenes,
  );
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
  available?: Set<string>,
  repeatIntro = false,
  discoveryIndex?: Map<string, DiscoveryEntry>,
  page?: PageRef,
  imagenes?: Map<string, string>,
): string[] {
  if (entries.length === 0) return [content];
  const imprimibles = printableEntries(entries);
  const intro = splitFrontmatter(content).body.trim();
  const paginas: string[] = [];
  for (let desde = 0; desde < imprimibles.length; desde += pageSize) {
    // Igual que el nav: las páginas son hermanas, no están en la raíz.
    const href = page?.outSlug === undefined ? undefined : `./${pageSlug(page.outSlug, paginas.length + 1)}.html`;
    paginas.push(
      collectionCards(
        entries,
        memberHrefs,
        desde === 0 || repeatIntro ? intro : '',
        desde,
        desde + pageSize,
        creatorHrefs,
        dir,
        available,
        discoveryIndex,
        page,
        href,
        imagenes,
      ),
    );
  }
  return paginas.length > 0 ? paginas : [content];
}

const IMAGEN_EN_MD = /(!\[[^\]]*\]\(\s*<?)([^)\s>]+)/g;
const IMAGEN_EN_HTML = /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)/gi;

/** Las imágenes de un miembro se resuelven contra su propio archivo. */
function absolutizaImagenes(body: string, dirAbs: string | undefined): string {
  if (dirAbs === undefined) return body;
  const absoluta = (src: string): string => (isAbsolute(src) || /^[a-z]+:/i.test(src) ? src : resolve(dirAbs, src));
  return body
    .replace(IMAGEN_EN_MD, (_m, abre: string, src: string) => `${abre}${absoluta(src)}`)
    .replace(IMAGEN_EN_HTML, (_m, abre: string, src: string) => `${abre}${absoluta(src)}`);
}

export function collectionScanContent(entries: CollectionEntry[], content: string): string {
  if (entries.length === 0) return content;
  const body = splitFrontmatter(content).body;
  // Sólo para escanear imágenes: cada cuerpo apunta a las suyas con ruta
  // absoluta, porque el miembro puede vivir en otro directorio.
  const conImagenes = entries.map((entrada) => ({ ...entrada, body: absolutizaImagenes(entrada.body, entrada.dirAbs) }));
  const sections = collectionBaseContent(conImagenes, 'latex', content);
  return body.trim() === '' ? sections : `${sections}\n\n${body}`;
}

const PAGINATION_BUTTON_CLASSES =
  'scroll-reveal-at-end pointer-events-auto flex h-12 items-center justify-center gap-2 rounded-full border border-accent-500/90 bg-accent-500/35 px-4 text-accent-700 shadow-lg shadow-accent-500/25 transition-colors duration-200 hover:border-accent-500 hover:bg-accent-500/45 dark:border-accent-500/70 dark:bg-accent-500/25 dark:text-accent-300 dark:hover:border-accent-500/90 dark:hover:bg-accent-500/35';

const PAGINATION_NAV_CLASSES = 'pointer-events-none fixed inset-x-0 bottom-6 z-50';

function pageSlug(outSlug: string, pagina: number): string {
  return pagina === 1 ? outSlug : `${outSlug}-${pagina}`;
}

/**
 * Los botones de paginación, flotantes junto al de «volver al principio»: el
 * anterior a su izquierda y el siguiente a su derecha. Se esconden hasta que
 * el scroll llega al final de la página.
 */
export function paginationNav(outSlug: string, pagina: number, total: number): string {
  if (total <= 1) return '';
  // Las páginas paginadas son hermanas: viven en el mismo directorio que la
  // primera, aunque la colección esté en un subdirectorio.
  const enlace = (n: number, texto: string, posicion: string): string =>
    `<a href="./${pageSlug(outSlug, n)}.html" class="${PAGINATION_BUTTON_CLASSES} fixed bottom-6 left-1/2 ${posicion}" aria-label="${texto}">${texto}</a>`;
  const anterior = pagina > 1 ? enlace(pagina - 1, '← Anterior', '-translate-x-[calc(100%_+_2rem)]') : '';
  const siguiente = pagina < total ? enlace(pagina + 1, 'Siguiente →', 'translate-x-[2rem]') : '';
  return `<nav class="${PAGINATION_NAV_CLASSES}">${anterior}${siguiente}</nav>`;
}

// `mt-0 mb-6` y `m-0`: el prose de la página mete márgenes a figure e img, y
// esos márgenes quedarían dentro del enlace (área clickeable de más).
const CARD_IMAGE_CLASSES = 'mt-0! mb-6! flex h-[150px] w-full items-center justify-center overflow-hidden rounded-tr-xl rounded-bl-xl';
const CARD_IMAGE_IMG_CLASSES = 'm-0! block h-full w-full object-cover';
const CARD_IMAGE_LINK_CLASSES = 'block h-full w-full rounded-tr-xl rounded-bl-xl';
const PORTRAIT_WRAPPER_CLASSES = 'mb-6 flex justify-center';
const PORTRAIT_CLASSES = 'm-0! block rounded-full object-cover';
const PORTRAIT_LINK_CLASSES = 'block overflow-hidden rounded-full [clip-path:circle(50%)]';

const IMAGEN_MD_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/;
const IMAGEN_HTML_RE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i;

/** La primera imagen del cuerpo, tal como viene en el markdown o el HTML. */
export function primeraImagenDelCuerpo(body: string): string | undefined {
  const md = IMAGEN_MD_RE.exec(body);
  const html = IMAGEN_HTML_RE.exec(body);
  if (md === null && html === null) return undefined;
  if (md === null) return html?.[1];
  if (html === null) return md[1];
  return (md.index as number) <= (html.index as number) ? md[1] : html[1];
}

/**
 * De la ruta absoluta de una imagen a la que debe llevar la página: las
 * imágenes web viven en el `assets/images` del directorio de la página.
 */
export function hrefsDeImagenes(imageMap: Map<string, string>, outputDir: string, dir: string): Map<string, string> {
  const base = join(outputDir, dir);
  const hrefs = new Map<string, string>();
  for (const [abs, processed] of imageMap) {
    if (processed === abs) continue;
    hrefs.set(abs, `./${posix(relative(base, processed))}`);
  }
  return hrefs;
}

function figuraDeTarjeta(href: string, enlace?: string): string {
  const img = `<img src="${href}" alt="" class="${CARD_IMAGE_IMG_CLASSES}">`;
  const dentro = enlace === undefined ? img : `<a href="${enlace}" class="${CARD_IMAGE_LINK_CLASSES}">${img}</a>`;
  return `<figure class="${CARD_IMAGE_CLASSES}">${dentro}</figure>`;
}

function retratoDeCreadora(href: string, nombre: string, enlace?: string): string {
  const img = `<img src="${href}" alt="Retrato de ${escaparHtml(nombre)}" class="${PORTRAIT_CLASSES}" style="width:150px;height:150px">`;
  const dentro =
    enlace === undefined
      ? img
      : `<a href="${enlace}" aria-label="Ver la biografía de ${escaparHtml(nombre)}" class="${PORTRAIT_LINK_CLASSES}">${img}</a>`;
  return `<div class="${PORTRAIT_WRAPPER_CLASSES}">${dentro}</div>`;
}

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * La tarjeta de índice de una colección, una por página: lista los textos de
 * esa página y enlaza con los índices de la página anterior y la siguiente.
 */
function collectionIndices(entries: CollectionEntry[], memberHrefs: Map<string, string>, outSlug: string, pageSize: number): string[] {
  const imprimibles = printableEntries(entries);
  const total = Math.ceil(imprimibles.length / pageSize);
  const indices: string[] = [];
  for (let pagina = 1; pagina <= total; pagina++) {
    const items = imprimibles
      .slice((pagina - 1) * pageSize, pagina * pageSize)
      .map((entrada) => {
        const href = memberHrefs.get(entrada.file);
        const titulo = escaparHtml(entrada.title || TITULO_POR_DEFECTO);
        return href === undefined
          ? `<li>${titulo}</li>`
          : `<li><a href="${href}" class="text-accent-700 no-underline underline-offset-4 hover:underline dark:text-accent-300">${titulo}</a></li>`;
      })
      .join('');
    const claseEnlace = 'text-accent-700 no-underline underline-offset-4 hover:underline dark:text-accent-300';
    const anterior =
      pagina > 1 ? `<a href="./${pageSlug(outSlug, pagina - 1)}.html#indice-pagina-${pagina - 1}" class="${claseEnlace}">← Índice anterior</a>` : '';
    const siguiente =
      pagina < total
        ? `<a href="./${pageSlug(outSlug, pagina + 1)}.html#indice-pagina-${pagina + 1}" class="${claseEnlace}">Índice siguiente →</a>`
        : '';
    indices.push(
      `<div class="break-inside-avoid pb-6" id="indice-pagina-${pagina}"><nav class="relative rounded-tr-xl rounded-bl-xl tarjeta p-4 sm:p-6 ring-1 ring-inset ring-stone-300/60 dark:ring-stone-600/40"><h2 class="inline-block align-top rounded-full border border-accent-500/30 bg-accent-500/12 px-3 py-1 font-normal uppercase tracking-wide text-xs leading-none mt-0 mb-6 text-accent-800 dark:text-accent-300">Índice</h2><ol class="m-0 list-decimal space-y-2 ps-6">${items}</ol><div class="mt-4 flex justify-between gap-4 text-sm">${anterior}${siguiente}</div></nav></div>`,
    );
  }
  return indices;
}

function indicesDeColeccion(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  entries: CollectionEntry[],
  memberHrefs: Map<string, string>,
  pageSize: number,
  siteConfig: SiteConfig,
): string[] {
  const tocActivo = typeof outputs.fm.toc === 'boolean' ? outputs.fm.toc : siteConfig.toc;
  if (doc.frontmatter.type !== 'collection' || !tocActivo) return [];
  return collectionIndices(entries, memberHrefs, outputs.outSlug, pageSize);
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

// El chip que abre una tarjeta extra deja aire antes del elemento que sigue.
const EXTRA_PILL_SPACED_CLASSES = `${PILL_BASE} mt-0 mb-6`;

// El chip de pertenencia sólo lleva contorno: el relleno de acento queda para
// el chip del tipo, que es el que dice qué es el documento.
const MEMBER_BADGE_CLASSES =
  'inline-block shrink-0 rounded-full border border-stone-300 bg-stone-200/70 px-2 py-1 font-semibold text-xs leading-none mt-0 text-stone-600 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-300';

const MEMBER_TYPE_LABEL: Record<string, string> = {
  file: 'Texto',
  creator: 'Colaboradora',
  collection: 'Colección',
  list: 'Lista',
  announcement: 'Anuncio',
};

// El chip de un keyword va en gris y sólo con contorno: así no se confunde con
// el del tipo (acento relleno) ni con el de una colección (acento con contorno).
const MEMBER_KEYWORD_PILL_CLASSES =
  'inline-block align-top rounded-full border border-stone-400/60 bg-transparent px-3 py-1 font-normal uppercase tracking-wide text-xs leading-none no-underline text-stone-600 dark:border-stone-500/60 dark:text-stone-300';

// El subrayado es la señal de que el chip es un enlace: sólo al pasar el ratón.
const CHIP_HOVER_CLASSES = 'transition-colors duration-200 hover:underline';

const CHIP_LINK_CLASSES = 'text-inherit no-underline transition-colors duration-200 hover:underline';

/**
 * El chip de tipo, con enlace a la lista por defecto de ese type. Si esa lista
 * es la página que se está armando, el chip se queda sin enlace: no tiene
 * sentido mandar a donde ya estás.
 */
function chipHtml(
  label: string,
  type: string | undefined,
  dir: string,
  classes = MEMBER_PILL_CLASSES,
  available?: Set<string>,
  currentHref?: string,
): string {
  const slug = defaultListSlug(type);
  const href = slug !== undefined && (available === undefined || available.has(slug)) ? defaultListHref(dir, type) : undefined;
  const chip = `<h2 class="${classes}">${label}</h2>`;
  if (href === undefined || href === currentHref) return chip;
  return `<h2 class="${classes}"><a href="${href}" class="${CHIP_LINK_CLASSES}">${label}</a></h2>`;
}

const MEMBER_LINK_CLASSES =
  'no-underline underline-offset-4 decoration-current/40 transition-colors duration-200 hover:underline hover:decoration-current';

// El CTA de las tarjetas y el «Ver más» del menú comparten el mismo botón:
// pill con el acento, para que no divergan con el tiempo.
const CARD_CTA_CLASSES =
  'inline-flex items-center gap-2 rounded-full bg-accent-600 px-4 py-2 text-sm font-semibold text-white no-underline shadow-sm transition-colors duration-200 hover:bg-accent-700 hover:text-white hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-accent-400 dark:text-stone-950 dark:hover:bg-accent-300';

/** El texto del CTA según lo que hay al otro lado. */
function ctaDeTarjeta(type: string | undefined): string {
  if (type === 'collection') return 'Ver colección completa';
  if (type === 'creator') return 'Ver página de la creadora';
  if (type === 'list') return 'Ver lista completa';
  if (type === 'announcement') return 'Leer anuncio';
  return 'Leer texto completo';
}

const EXTRA_CARD_CLASSES = `tarjeta-extras relative rounded-tr-xl rounded-bl-xl tarjeta p-6 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 [overflow-wrap:anywhere] ${CARD_TEXT_CLASSES}`;

/** La licencia CC que el sitio sabe pintar (iconos y texto). */
const LICENCIA_CC_BY_NC_ND = 'CC-BY-NC-ND-4.0';

const TEXTO_LICENCIA =
  'Algunos derechos reservados. Esta obra está bajo una Licencia Creative Commons Atribución-NoComercial-SinDerivadas 4.0 Internacional. Usted es libre de compartir, copiar y redistribuir el material en cualquier medio o formato, pero debe dar crédito de manera adecuada, brindar un enlace a la&nbsp;licencia e indicar si se han realizado cambios. No puede hacer uso de esta obra con propósitos comerciales, ni remezclar, transformar o crear obras derivadas, ni distribuir el material modificado.';

/** La tarjeta de licencia, site-wide, antes del footer. */
function licenciaHtml(siteConfig: SiteConfig, dir: string): string | undefined {
  if (siteConfig.format?.html?.site?.license !== LICENCIA_CC_BY_NC_ND) return undefined;
  const iconos = ['cc', 'by', 'nc', 'nd']
    .map((nombre) => `<img src="${relativeHref(dir, `${ASSETS_IMAGES_DIR}/${nombre}.svg`)}" alt="" class="block" style="width:15pt">`)
    .join('');
  return [
    '<div class="break-inside-avoid pb-6">',
    `<div class="${EXTRA_CARD_CLASSES}">`,
    `<div class="mb-4 flex items-center gap-2">${iconos}</div>`,
    `<p class="m-0 text-xs leading-relaxed">${TEXTO_LICENCIA}</p>`,
    '</div>',
    '</div>',
  ].join('');
}

/** La tarjeta con la biografía de una creadora. */
export function creatorCard(
  doc: CreatorDoc,
  dir: string,
  creatorHrefs: Map<string, string>,
  available?: Set<string>,
  imagenes?: Map<string, string>,
): string {
  const retrato = doc.image === undefined ? undefined : imagenes?.get(doc.image);
  const perfil = creatorHrefs.get(doc.name);
  return [
    `:::: {class="${EXTRA_CARD_CLASSES}"}`,
    '',
    chipHtml('Colaboradora', 'creator', dir, EXTRA_PILL_SPACED_CLASSES, available),
    '',
    ...(retrato === undefined ? [] : [retratoDeCreadora(retrato, doc.name, perfil), '']),
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
export function containersCard(
  contenedores: { titulo: string; href: string; type: string | undefined }[],
  dir: string,
  available?: Set<string>,
): string {
  const chips: string[] = [];
  if (contenedores.some((c) => c.type === 'collection')) chips.push(chipHtml('Colecciones', 'collection', dir, EXTRA_PILL_CLASSES, available));
  if (contenedores.some((c) => c.type === 'list')) chips.push(chipHtml('Listas', 'list', dir, EXTRA_PILL_CLASSES, available));
  const items = contenedores.map((c) => `- [${c.titulo}](${c.href})`).join('\n');
  return [
    `:::: {class="${EXTRA_CARD_CLASSES}"}`,
    '',
    `<div class="flex flex-wrap items-center gap-2 mb-4">${chips.join('')}</div>`,
    '',
    items,
    '',
    '::::',
  ].join('\n');
}

/** La tarjeta que lista los keywords del documento, cada uno con su lista. */
export function keywordsCard(keywords: { titulo: string; href: string }[]): string {
  const items = keywords.map((k) => `- [${k.titulo}](${k.href})`).join('\n');
  return [
    `:::: {class="${EXTRA_CARD_CLASSES}"}`,
    '',
    `<div class="flex flex-wrap items-center gap-2 mb-4"><h2 class="${EXTRA_PILL_CLASSES}">Palabras clave</h2></div>`,
    '',
    items,
    '',
    '::::',
  ].join('\n');
}

interface EnlaceMenu {
  name: string;
  url: string;
}

/** Los enlaces del único `type: menu` del proyecto. */
function enlacesDelMenu(discoveryIndex: Map<string, DiscoveryEntry>): EnlaceMenu[] {
  const menus = [...discoveryIndex.entries()].filter(([, entry]) => entry.type === 'menu');
  if (menus.length > 1) {
    throw new BuildError(`solo puede haber un "type: menu"; hay ${menus.length}: ${menus.map(([ruta]) => `"${ruta}"`).join(', ')}`);
  }
  const links = menus[0]?.[1].fm?.links;
  if (!Array.isArray(links)) return [];
  return links.flatMap((link) => {
    if (typeof link !== 'object' || link === null) return [];
    const { name, url } = link as Record<string, unknown>;
    return typeof name === 'string' && typeof url === 'string' ? [{ name, url }] : [];
  });
}

function esEnlaceExterno(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url);
}

/** Un enlace del menú, con la ruta relativa a la página que lo pinta. */
function hrefDeMenu(url: string, dir: string): string {
  if (esEnlaceExterno(url) || /^(?:mailto|tel):/i.test(url) || url.startsWith('#')) return url;
  return relativeHref(dir, url.replace(/^\.?\//, ''));
}

function enlaceDeMenuHtml(enlace: EnlaceMenu, dir: string): string {
  const attrs = esEnlaceExterno(enlace.url) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${escaparHtml(hrefDeMenu(enlace.url, dir))}" class="${MEMBER_LINK_CLASSES}"${attrs}>${escaparHtml(enlace.name)}</a>`;
}

/** La tarjeta del menú: los primeros 3 enlaces y «Ver más» si hay más. */
function menuCardHtml(links: EnlaceMenu[], dir: string, siteTitle: string): string | undefined {
  if (links.length === 0) return undefined;
  const items = links
    .slice(0, 3)
    .map((enlace) => `<li>${enlaceDeMenuHtml(enlace, dir)}</li>`)
    .join('');
  const mas =
    links.length > 3 ? `<p class="mt-4 text-center"><a href="${relativeHref(dir, 'menu.html')}" class="${CARD_CTA_CLASSES}">Ver más →</a></p>` : '';
  return [
    '<div class="break-inside-avoid pb-6">',
    `<div class="${EXTRA_CARD_CLASSES}">`,
    `<div class="flex flex-wrap items-center gap-2 mb-4"><h2 class="${EXTRA_PILL_CLASSES}">Menú</h2><span class="${CHIP_OUTLINE_CLASSES}">${escaparHtml(siteTitle)}</span></div>`,
    `<ul class="m-0 list-disc space-y-2 ps-6">${items}</ul>`,
    mas,
    '</div>',
    '</div>',
  ].join('');
}

/** Las tarjetas de los anuncios, en HTML, para los slots del sitio. */
async function renderAnuncios(args: {
  entries: CollectionEntry[];
  discoveryIndex: Map<string, DiscoveryEntry>;
  dir: string;
  available?: Set<string>;
  creatorHrefs: Map<string, string>;
  imagenes: Map<string, string>;
  filters: ExportContext['filters'];
  imagePaths?: string;
  sourcePath: string;
}): Promise<string> {
  const cards = args.entries
    .map((entry) => {
      const destino = args.discoveryIndex.get(entry.file);
      if (destino?.slug === undefined) return '';
      const rel = posix(join(dirname(entry.file), `${htmlSlugFor(entry.file, destino.slug)}.html`));
      return collectionCard(
        entry,
        relativeHref(args.dir, rel),
        args.creatorHrefs,
        args.dir,
        args.available,
        args.discoveryIndex,
        undefined,
        undefined,
        args.imagenes,
      );
    })
    .filter((card) => card !== '')
    .join('\n\n');
  if (cards === '') return '';
  const extraArgs: string[] = [];
  for (const filter of [...args.filters.semantic, ...args.filters.user, ...args.filters.flags, ...args.filters.html]) {
    extraArgs.push('--lua-filter', filter);
  }
  const html = await execPandoc({
    input: cards,
    sourcePath: args.sourcePath,
    from: MD_READER,
    to: 'html5',
    extraArgs,
    env: imagePathsEnv(args.imagePaths),
  });
  return minifyHtml(html);
}

/** Las tarjetas de anuncios que van en los slots de una página. */
async function anunciosDeLaPagina(args: {
  discoveryIndex: Map<string, DiscoveryEntry>;
  cwd: string;
  dir: string;
  docPath?: string;
  available?: Set<string>;
  creatorHrefs: Map<string, string>;
  imagenes: Map<string, string>;
  outputDir: string;
  announcementImages?: Map<string, string>;
  filters: ExportContext['filters'];
  imagePaths?: string;
  sourcePath: string;
}): Promise<{ top: string; bottom: string }> {
  const anuncios = (await readAnuncios(args.discoveryIndex, args.cwd)).filter((entry) => posix(entry.file).replace(/^\.\//, '') !== args.docPath);
  const imagenes = new Map([
    ...(args.announcementImages === undefined ? [] : hrefsDeImagenes(args.announcementImages, args.outputDir, args.dir)),
    ...args.imagenes,
  ]);
  const comunes = {
    discoveryIndex: args.discoveryIndex,
    dir: args.dir,
    available: args.available,
    creatorHrefs: args.creatorHrefs,
    imagenes,
    filters: args.filters,
    imagePaths: args.imagePaths,
    sourcePath: args.sourcePath,
  };
  const top = await renderAnuncios({ ...comunes, entries: anuncios.filter((entry) => placementDe(entry, args.discoveryIndex) === 'top') });
  const bottom = await renderAnuncios({ ...comunes, entries: anuncios.filter((entry) => placementDe(entry, args.discoveryIndex) === 'bottom') });
  return { top, bottom };
}

/** Procesa una sola vez las imágenes de cabecera de los anuncios. */
export async function preparaImagenesDeAnuncios(args: {
  cwd: string;
  outputDir: string;
  discoveryIndex: Map<string, DiscoveryEntry>;
  pdfxActive: boolean;
}): Promise<Map<string, string>> {
  const anuncios = await readAnuncios(args.discoveryIndex, args.cwd);
  if (anuncios.length === 0) return new Map();
  const procesadas = await processWebImages(
    imagenesDeLasTarjetas(anuncios, args.cwd),
    join(args.outputDir, ASSETS_IMAGES_DIR),
    imageNamerFor('anuncio', 'webp'),
    args.pdfxActive,
  );
  return procesadas.imageMap;
}

/** Los anuncios del sitio, ordenados por fecha descendente. */
async function readAnuncios(discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): Promise<CollectionEntry[]> {
  const rutas = [...discoveryIndex.entries()].filter(([, entry]) => entry.type === 'announcement').map(([ruta]) => ruta);
  if (rutas.length === 0) return [];
  const entries = await readCollectionEntries(rutas, 'anuncios.md', [cwd], true);
  return entries.sort((a, b) => fechaOrdenable(discoveryIndex.get(b.file)) - fechaOrdenable(discoveryIndex.get(a.file)));
}

/** El cuerpo de `menu.html`: todos los enlaces, en markdown. */
function menuPageMarkdown(links: EnlaceMenu[], dir: string): string {
  return links
    .map((enlace) => {
      const attrs = esEnlaceExterno(enlace.url) ? '{target="_blank" rel="noopener noreferrer"}' : '';
      return `- [${enlace.name}](${hrefDeMenu(enlace.url, dir)})${attrs}`;
    })
    .join('\n');
}

/** La tarjeta con las redes de la creadora, con su nombre como dueño. */
export function creatorLinksCard(nombre: string, links: { name: string; url: string }[]): string {
  // Fuera del sitio, igual que las redes del proyecto: se abren aparte.
  const items = links.map((l) => `- [${l.name}](<${l.url}>){target="_blank" rel="noopener noreferrer"}`).join('\n');
  return [
    `:::: {class="${EXTRA_CARD_CLASSES}"}`,
    '',
    `<div class="flex flex-wrap items-center gap-2 mb-4"><h2 class="${EXTRA_PILL_CLASSES}">Redes</h2><span class="${CHIP_OUTLINE_CLASSES}">${escaparHtml(nombre)}</span></div>`,
    '',
    items,
    '',
    '::::',
  ].join('\n');
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
  palabrasClave: { titulo: string; href: string }[];
  redesCreador: { name: string; url: string }[];
  duenoRedes: string;
  creatorHrefs: Map<string, string>;
  available?: Set<string>;
  filters: ExportContext['filters'];
  imagePaths?: string;
  imagenes?: Map<string, string>;
  sourcePath: string;
  dir: string;
}): Promise<string> {
  const partes: string[] = [];
  // Cada tarjeta va en su propia celda del masonry, con su separación.
  for (const doc of args.creatorDocs) {
    partes.push([MASONRY_WRAPPER, '', creatorCard(doc, args.dir, args.creatorHrefs, args.available, args.imagenes), '', '</div>'].join('\n'));
  }
  // La tarjeta "También está en" se muestra si el texto vive en al menos una
  // colección real. No se crea si no pertenece a ninguna colección o sólo a
  // las listas por defecto (que nunca aparecen aquí).
  if (args.contenedores.some((c) => c.type === 'collection')) {
    partes.push([MASONRY_WRAPPER, '', containersCard(args.contenedores, args.dir, args.available), '', '</div>'].join('\n'));
  }
  if (args.palabrasClave.length > 0) {
    partes.push([MASONRY_WRAPPER, '', keywordsCard(args.palabrasClave), '', '</div>'].join('\n'));
  }
  if (args.redesCreador.length > 0) {
    partes.push([MASONRY_WRAPPER, '', creatorLinksCard(args.duenoRedes, args.redesCreador), '', '</div>'].join('\n'));
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

const KEYWORD_CACHE = 'keyword-lists.json';

async function leerKeywordCache(cwd: string): Promise<string[]> {
  try {
    const raw = JSON.parse(await Bun.file(join(cwd, '.iteraciones', KEYWORD_CACHE)).text()) as unknown;
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Las listas por keyword: una página en `keywords/` con los documentos que
 * declaran ese keyword. Las que dejan de existir se borran de la salida.
 */
export async function emitKeywordLists(args: {
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
  const hrefsCreadores = creatorHrefs(discoveryIndex, KEYWORDS_DIR);
  const available = availableDefaultListSlugs(discoveryIndex);

  const listas = keywordListsOf(discoveryIndex)
    .map((lista) => ({ ...lista, miembros: keywordMembers(discoveryIndex, lista.slug) }))
    .filter((lista) => lista.miembros.length > 0);

  const previas = await leerKeywordCache(cwd);
  const actuales = new Set(listas.map((l) => l.slug));
  for (const slug of previas) {
    if (actuales.has(slug) || htmlOwner(discoveryIndex, KEYWORDS_DIR, slug) !== undefined) continue;
    await rm(join(outputDir, KEYWORDS_DIR, `${slug}.html`), { force: true }).catch(() => {});
    await removeExtraHtmlPages(outputDir, KEYWORDS_DIR, slug, 0, discoveryIndex);
  }
  await mkdir(join(cwd, '.iteraciones'), { recursive: true });
  await Bun.write(join(cwd, '.iteraciones', KEYWORD_CACHE), `${JSON.stringify([...actuales].sort())}\n`);

  const entradas = [];
  for (const lista of listas) {
    const propias = await readCollectionEntries(lista.miembros, `${KEYWORDS_DIR}/${lista.slug}.md`, [cwd], true);
    entradas.push({ ...lista, entradas: propias });
  }
  const procesadas = await processWebImages(
    imagenesDeLasTarjetas(
      entradas.flatMap((l) => l.entradas),
      cwd,
    ),
    join(outputDir, ASSETS_IMAGES_DIR),
    imageNamerFor('keywords', 'webp'),
    renderCtx.pdfxActive,
  );

  for (const { slug, label, miembros, entradas: propias } of entradas) {
    const relativePath = `${KEYWORDS_DIR}/${slug}.md`;
    if (htmlOwner(discoveryIndex, KEYWORDS_DIR, slug) !== undefined) {
      logWarning(`no se escribió la lista de "${label}" porque "${KEYWORDS_DIR}/${slug}.html" es el archivo de ese documento`, 'build');
      continue;
    }
    const memberHrefs = memberHtmlHrefs(relativePath, propias, discoveryIndex);
    const paginas = collectionCardsPages(
      propias,
      memberHrefs,
      `Contenidos con la palabra clave «${label}».`,
      pageSize,
      hrefsCreadores,
      KEYWORDS_DIR,
      available,
      true,
      discoveryIndex,
      { path: relativePath, outSlug: slug, keywordSlug: slug },
      hrefsDeImagenes(procesadas.imageMap, outputDir, KEYWORDS_DIR),
    );
    const doc: BuildDocument = {
      filePath: join(cwd, KEYWORDS_DIR, `${slug}.md`),
      relativePath,
      frontmatter: { title: label, date: '', creator: [], type: 'list', files: miembros },
    };
    const outputs: DocumentOutputs = {
      slug,
      outSlug: slug,
      dir: KEYWORDS_DIR,
      fm: { title: label, type: 'list' },
      content: '',
      outBase: (name: string): string => join(outputDir, KEYWORDS_DIR, name),
    };
    const imagePaths = await writeListImagePaths(cwd, `${KEYWORDS_DIR}-${slug}`, procesadas.imageMap);
    const menu = menuCardHtml(enlacesDelMenu(discoveryIndex), KEYWORDS_DIR, formatCfg?.html?.site?.title ?? 'iteraciones');
    const { top: anunciosTop, bottom: anunciosBottom } = await anunciosDeLaPagina({
      discoveryIndex,
      cwd,
      dir: KEYWORDS_DIR,
      available,
      creatorHrefs: hrefsCreadores,
      imagenes: hrefsDeImagenes(procesadas.imageMap, outputDir, KEYWORDS_DIR),
      outputDir,
      announcementImages: renderCtx.announcementImages,
      filters: exportCtx.filters,
      imagePaths,
      sourcePath: doc.filePath,
    });
    await emitHtmlPage(
      doc,
      outputs,
      renderCtx,
      exportCtx,
      discoveryIndex,
      imagePaths,
      paginas,
      hrefsCreadores,
      '',
      'Palabras clave',
      undefined,
      undefined,
      undefined,
      menu,
      anunciosTop,
      anunciosBottom,
    );
    await removeExtraHtmlPages(outputDir, KEYWORDS_DIR, slug, paginas.length, discoveryIndex);
  }
}

/** Las creadoras de cada texto de la colección, sin repetir y en orden alfabético. */
function creadoresDeArchivosDeColeccion(e: CollectionEntry, discoveryIndex: Map<string, DiscoveryEntry>): string[] {
  const coleccion = discoveryIndex.get(e.file);
  const nombres = new Set<string>();
  for (const miembro of coleccion?.files ?? []) {
    for (const nombre of discoveryIndex.get(miembro)?.creator ?? []) nombres.add(nombre);
  }
  return [...nombres].sort((a, b) => a.localeCompare(b, 'es'));
}

function ordenarNombres(nombres: string[]): string[] {
  return [...new Set(nombres)].sort((a, b) => a.localeCompare(b, 'es'));
}

function renderNombres(lista: string[], tono: 'accent' | 'gris' | 'plano', creatorHrefs: Map<string, string>): string {
  return lista.map((n) => `<span class="whitespace-nowrap">${nombreEnlazadoHtml(n, creatorHrefs, tono)}</span>`).join(', ');
}

/** Las partes de una tarjeta de colección, después del chip: título, autoras de los textos, prefijo y antologadora. */
function partesDeColeccion(
  e: CollectionEntry,
  titleHtml: string,
  creatorHrefs: Map<string, string>,
  discoveryIndex?: Map<string, DiscoveryEntry>,
): string[] {
  const partes = [titleHtml, ''];
  const nombres = discoveryIndex === undefined ? [] : creadoresDeArchivosDeColeccion(e, discoveryIndex);
  if (nombres.length > 0) {
    partes.push(
      `<p class="not-prose nombres-enlazados-gris mt-2 mb-6 text-center text-base leading-relaxed text-stone-900 dark:text-stone-100">${renderNombres(nombres, 'plano', creatorHrefs)}</p>`,
    );
  }
  const coleccion = discoveryIndex?.get(e.file);
  const prefijo = typeof coleccion?.fm?.collectionCreatorPrefix === 'string' ? coleccion.fm.collectionCreatorPrefix : '';
  if (prefijo !== '') partes.push(`<p class="not-prose mt-8 mb-1 text-center text-sm font-mono text-stone-700 dark:text-stone-300">${prefijo}</p>`);
  const antologistas = ordenarNombres(parseAuthors(coleccion?.fm?.collectionCreator));
  if (antologistas.length > 0) {
    partes.push(
      `<p class="not-prose nombres-enlazados-gris mb-8 text-center text-lg font-bold text-stone-900 dark:text-stone-100">${renderNombres(antologistas, 'plano', creatorHrefs)}</p>`,
    );
  }
  return partes;
}

function creadoresDeTarjeta(e: CollectionEntry, discoveryIndex?: Map<string, DiscoveryEntry>): { tono: 'accent' | 'gris'; nombres?: string[] } {
  const tipo = e.type ?? 'file';
  if (tipo === 'creator') return { tono: 'accent' };
  if (tipo === 'collection') return { tono: 'gris', nombres: discoveryIndex === undefined ? [] : creadoresDeArchivosDeColeccion(e, discoveryIndex) };
  return { tono: 'gris', nombres: e.creator };
}

function titleHtmlPara(title: string, href: string | undefined): string {
  if (href === undefined) return `<h3 class="text-center text-[22px] font-bold text-accent-900 dark:text-accent-300 mb-6">${title}</h3>`;
  return `<h3 class="text-center text-[22px] font-bold text-accent-900 dark:text-accent-300 mb-6"><a href="${href}" class="${MEMBER_LINK_CLASSES}">${title}</a></h3>`;
}

/**
 * Los chips de pertenencia de un miembro: una colección o lista por chip. Si el
 * contenedor es la página que se está armando, el chip se muestra sin enlace:
 * sirve para recordar a qué pertenece el texto, no para volver a sí mismo.
 */
/** La página que se está armando: su ruta y, si se sabe, su slug de salida. */
interface PageRef {
  path: string;
  outSlug?: string;
  /** El slug del keyword cuando la página es la lista de ese keyword. */
  keywordSlug?: string;
}

function chipsDePertenencia(
  e: CollectionEntry,
  dir: string,
  pagePath: string | undefined,
  discoveryIndex: Map<string, DiscoveryEntry> | undefined,
): string[] {
  const contenedores = discoveryIndex?.get(e.file)?.containedBy ?? [];
  const chips: string[] = [];
  for (const ruta of contenedores) {
    const contenedor = discoveryIndex?.get(ruta);
    if (contenedor?.type !== 'collection' && contenedor?.type !== 'list') continue;
    const titulo = escaparHtml(contenedor.title || ruta);
    if (ruta === pagePath) {
      chips.push(`<span class="${CHIP_OUTLINE_CLASSES}">${titulo}</span>`);
      continue;
    }
    const html = posix(join(dirname(ruta), `${htmlSlugFor(ruta, contenedor.slug)}.html`));
    chips.push(`<a href="${relativeHref(dir, html)}" class="${CHIP_OUTLINE_CLASSES} ${CHIP_HOVER_CLASSES}">${titulo}</a>`);
  }
  return chips;
}

/** Los keywords del documento, uno por slug y en orden alfabético, con su lista. */
function palabrasClaveDe(relativePath: string, dir: string, discoveryIndex: Map<string, DiscoveryEntry>): { titulo: string; href: string }[] {
  const porSlug = new Map<string, string>();
  for (const keyword of keywordsOf(discoveryIndex.get(relativePath))) {
    const slug = keywordSlug(keyword);
    if (slug === undefined) continue;
    if (htmlOwner(discoveryIndex, KEYWORDS_DIR, slug) !== undefined) continue;
    const actual = porSlug.get(slug);
    if (actual === undefined || keyword.localeCompare(actual, 'es') < 0) porSlug.set(slug, keyword);
  }
  return [...porSlug].sort(([, a], [, b]) => a.localeCompare(b, 'es')).map(([slug, label]) => ({ titulo: label, href: keywordHref(dir, slug) }));
}

/** Los chips de los keywords del miembro, en orden alfabético. */
function chipsDeKeywords(
  e: CollectionEntry,
  dir: string,
  page: PageRef | undefined,
  discoveryIndex: Map<string, DiscoveryEntry> | undefined,
): string[] {
  const porSlug = new Map<string, string>();
  for (const keyword of keywordsOf(discoveryIndex?.get(e.file))) {
    const slug = keywordSlug(keyword);
    if (slug === undefined) continue;
    // Si un documento ocupa esa ruta, la lista no existe: mejor no ofrecerla.
    if (discoveryIndex !== undefined && htmlOwner(discoveryIndex, KEYWORDS_DIR, slug) !== undefined) continue;
    const actual = porSlug.get(slug);
    if (actual === undefined || keyword.localeCompare(actual, 'es') < 0) porSlug.set(slug, keyword);
  }
  return [...porSlug]
    .sort(([, a], [, b]) => a.localeCompare(b, 'es'))
    .map(([slug, label]) => {
      const titulo = escaparHtml(label);
      if (page?.keywordSlug === slug) return `<span class="${MEMBER_KEYWORD_PILL_CLASSES}">${titulo}</span>`;
      return `<a href="${keywordHref(dir, slug)}" class="${MEMBER_KEYWORD_PILL_CLASSES} ${CHIP_HOVER_CLASSES}">${titulo}</a>`;
    });
}

function chipsDeCabecera(
  e: CollectionEntry,
  dir: string,
  available?: Set<string>,
  discoveryIndex?: Map<string, DiscoveryEntry>,
  page?: PageRef,
  currentHref?: string,
): string {
  const typeLabel = MEMBER_TYPE_LABEL[e.type ?? 'file'];
  if (typeLabel === undefined) return '';
  const chips = [
    chipHtml(typeLabel, e.type, dir, `${PILL_BASE} mt-0 mb-0`, available, currentHref),
    ...chipsDePertenencia(e, dir, page?.path, discoveryIndex),
    ...chipsDeKeywords(e, dir, page, discoveryIndex),
  ];
  return `<div class="flex items-start justify-between gap-4"><div class="flex flex-wrap items-center gap-2 mb-6">${chips.join('')}</div><span class="${MEMBER_BADGE_CLASSES}">${e.posicion}</span></div>`;
}

function imagenDeCabecera(
  e: CollectionEntry,
  tipo: string,
  imagenes: Map<string, string> | undefined,
  creatorHrefs: Map<string, string>,
  discoveryIndex: Map<string, DiscoveryEntry> | undefined,
  href: string | undefined,
): string | undefined {
  const src = tipo === 'creator' ? e.image : primeraImagenDelCuerpo(e.body);
  if (src === undefined) return undefined;
  const abs = isAbsolute(src) ? src : resolve(e.dirAbs ?? '.', src);
  const imagen = imagenes?.get(abs);
  if (imagen === undefined) return undefined;
  if (tipo === 'creator') return retratoDeCreadora(imagen, e.title || TITULO_POR_DEFECTO, href);
  // La imagen del texto lleva a la biografía de su autora, como el nombre.
  const primera = creadoresDeTarjeta(e, discoveryIndex).nombres?.[0];
  return figuraDeTarjeta(imagen, primera === undefined ? undefined : creatorHrefs.get(primera));
}

function cabeceraDeTarjeta(
  e: CollectionEntry,
  titleHtml: string,
  creatorHrefs: Map<string, string>,
  dir: string,
  available?: Set<string>,
  discoveryIndex?: Map<string, DiscoveryEntry>,
  page?: PageRef,
  currentHref?: string,
  imagenes?: Map<string, string>,
  href?: string,
): string[] {
  const tipo = e.type ?? 'file';
  const partes: string[] = [];
  const chips = chipsDeCabecera(e, dir, available, discoveryIndex, page, currentHref);
  if (chips !== '') partes.push(chips, '');
  const imagen = imagenDeCabecera(e, tipo, imagenes, creatorHrefs, discoveryIndex, href);
  if (imagen !== undefined) partes.push(imagen, '');
  if (tipo === 'collection') return [...partes, ...partesDeColeccion(e, titleHtml, creatorHrefs, discoveryIndex)];
  const { tono, nombres } = creadoresDeTarjeta(e, discoveryIndex);
  const creator = nombres === undefined ? '' : nombres.length > 0 ? renderNombres(nombres, tono, creatorHrefs) : AUTORA_POR_DEFECTO;
  if (creator !== '') partes.push(`<h2 class="text-center text-base">${creator}</h2>`, '');
  partes.push(titleHtml);
  if (e.subtitle) partes.push('', `<h4 class="text-center text-lg italic tracking-wide mb-4">${e.subtitle}</h4>`);
  return partes;
}

function collectionCard(
  e: CollectionEntry,
  href: string | undefined,
  creatorHrefs: Map<string, string>,
  dir: string,
  available?: Set<string>,
  discoveryIndex?: Map<string, DiscoveryEntry>,
  page?: PageRef,
  currentHref?: string,
  imagenes?: Map<string, string>,
): string {
  const title = e.title || TITULO_POR_DEFECTO;
  const fragment = extractFragment(e.body);
  const card = [
    `:::: {class="${COLLECTION_CARD_CLASSES}"}`,
    '',
    ...cabeceraDeTarjeta(e, titleHtmlPara(title, href), creatorHrefs, dir, available, discoveryIndex, page, currentHref, imagenes, href),
  ];
  if (fragment !== '') card.push('', fragment);
  if (href !== undefined) {
    card.push('', `<p class="text-center mt-4"><a href="${href}" class="${CARD_CTA_CLASSES}">${ctaDeTarjeta(e.type)} →</a></p>`);
  }
  card.push('', '::::');
  return [MASONRY_WRAPPER, '', ...card, '', '</div>'].join('\n');
}

/** Baja los encabezados del cuerpo para que no compitan con los del merge. */
function desplazaEncabezados(body: string, salto: number): string {
  let dentroDeCodigo = false;
  return body
    .split('\n')
    .map((linea) => {
      if (/^\s*(```|~~~)/.test(linea)) {
        dentroDeCodigo = !dentroDeCodigo;
        return linea;
      }
      if (dentroDeCodigo) return linea;
      const encontrado = /^(#{1,6})(\s)/.exec(linea);
      const marcas = encontrado?.[1];
      if (marcas === undefined) return linea;
      const nivel = Math.min(6, marcas.length + salto);
      return `${'#'.repeat(nivel)}${linea.slice(marcas.length)}`;
    })
    .join('\n');
}

/**
 * El merge de una collection: cada texto con su autora y su título, sin las
 * interventions (no tienen contenido que leer) y con los encabezados del cuerpo
 * bajados, para que el `#` de la colección mande.
 */
function buildCollectionSectionsMarkdown(entries: CollectionEntry[], merge: boolean): string {
  return buildCollectionSections(merge ? printableEntries(entries) : entries, MARKDOWN_HEADINGS, merge ? 4 : 0);
}

/** La sección de autoras y colaboradoras del markdown mergeado. */
function buildAuthorsMarkdown(authoras: CreatorDoc[]): string {
  if (authoras.length === 0) return '';
  const partes: string[] = ['# Autoras y colaboradoras'];
  for (const autora of authoras) {
    partes.push(`##### ${autora.name}`);
    if (autora.links.length > 0) partes.push(autora.links.map((l) => `**${l.name}**: ${l.url}`).join('\n'));
    partes.push(autora.body.trim());
  }
  return partes.join('\n\n');
}

function resolveCollectionContent(
  collectionEntries: CollectionEntry[],
  format: 'latex' | 'html' | 'markdown',
  fallback: string,
  pageNumber?: string,
  merge = false,
  imageMap?: Map<string, string>,
): string {
  if (format === 'latex') return buildCollectionSectionsLatex(collectionEntries, pageNumber, imageMap);
  if (format === 'html') {
    const printable = printableEntries(collectionEntries);
    return printable.length === 0 ? fallback : buildCollectionSectionsHtml(printable);
  }
  return buildCollectionSectionsMarkdown(collectionEntries, merge);
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

  /** El retrato del frontmatter, resuelto contra el archivo de la creadora. */
  image?: string;
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

async function parseCreatorDoc(
  yaml: string,
  filePath: string,
  relativePath: string,
  label: string,
): Promise<{ name: string; links: { name: string; url: string }[]; image: string | undefined }> {
  const { value, error } = parseYamlWithPosition(yaml);
  if (error) throw new BuildError(`${label}: frontmatter inválido en "${relativePath}": ${error}`);
  const parsed = value as Record<string, unknown> | undefined;
  const name = typeof parsed?.name === 'string' && parsed.name ? parsed.name : typeof parsed?.title === 'string' ? parsed.title : '';
  const links = parsed ? getCreatorLinks(parsed) : [];
  const retrato = fmTrimmedString(parsed?.image);
  if (retrato === undefined) return { name, links, image: undefined };
  const abs = isAbsolute(retrato) ? retrato : resolve(dirname(filePath), retrato);
  if (await Bun.file(abs).exists()) return { name, links, image: abs };
  logWarning(`${label}: la imagen "${retrato}" de la creadora "${name}" no existe; la tarjeta va sin retrato`, 'build');
  return { name, links, image: undefined };
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
  const { name, links, image } =
    yaml === undefined ? { name: '', links: [], image: undefined } : await parseCreatorDoc(yaml, filePath, relativePath, label);
  if (!body.trim()) {
    throw new BuildError(`${label}: creator "${name}" debe tener body (contenido después del frontmatter)`);
  }
  return { name, body, relativePath, links, image };
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
  merge = false,
  imageMap?: Map<string, string>,
): string {
  const resuelto = collectionEntries.length > 0 ? resolveCollectionContent(collectionEntries, format, content, pageNumber, merge, imageMap) : content;
  return format === 'latex' ? resuelto : espaciosNormales(resuelto);
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

/** La fecha que ordena las tarjetas: `date`; sin fecha, al final. */
function fechaDeContenido(entry: DiscoveryEntry | undefined): number {
  if (entry?.date !== undefined) {
    const fecha = Date.parse(entry.date);
    if (!Number.isNaN(fecha)) return fecha;
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * Los documentos donde participa la creadora del documento, como `creator` o
 * como `collectionCreator`: textos y colecciones. Lo más reciente primero.
 */
function documentosDeLaCreadora(doc: BuildDocument, outputs: DocumentOutputs, discoveryIndex: Map<string, DiscoveryEntry>): string[] {
  if (doc.frontmatter.type !== 'creator') return [];
  const nombre = String(outputs.fm.name ?? outputs.fm.title ?? '');
  if (nombre === '') return [];
  const rutas = [...discoveryIndex.entries()]
    .filter(([, entry]) => entry.type === undefined || entry.type === 'file' || entry.type === 'collection')
    .filter(([, entry]) => [...entry.creator, ...parseAuthors(entry.fm?.collectionCreator)].includes(nombre))
    .map(([ruta]) => ruta);
  return rutas.sort((a, b) => {
    const fecha = fechaDeContenido(discoveryIndex.get(b)) - fechaDeContenido(discoveryIndex.get(a));
    if (fecha !== 0) return fecha;
    return (discoveryIndex.get(a)?.title ?? a).localeCompare(discoveryIndex.get(b)?.title ?? b, 'es');
  });
}

/** Las entradas completas de las tarjetas de una creadora. */
async function entradasDeLaCreadora(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  discoveryIndex: Map<string, DiscoveryEntry>,
  cwd: string,
): Promise<CollectionEntry[]> {
  const rutas = documentosDeLaCreadora(doc, outputs, discoveryIndex);
  if (rutas.length === 0) return [];
  return readCollectionEntries(rutas, doc.relativePath, [cwd], true);
}

async function preprocessDocImages(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  collectionEntries: CollectionEntry[],
  creatorDocs: CreatorDoc[],
  content: string,
  renderCtx: RenderContext,
  extraEntries: CollectionEntry[] = [],
): Promise<DocumentImages> {
  const { ctx, plan, formatCfg } = renderCtx;
  const active = plan.activeFormats;
  const fmBase = mergeConfigImages(outputs.fm, formatCfg?.pdf, ctx.siteConfig, ctx.cwd);
  // La colección junta las interventions: sus imágenes de membrete también se
  // procesan aquí para que el PDF las pueda usar. En un texto suelto manda su
  // propio frontmatter.
  const membreteColeccion = collectionLetterheadFiles(collectionEntries);
  return preprocessDocumentImages({
    content: [
      collectionScanContent(collectionEntries, content),
      // El retrato de la creadora vive en su frontmatter, no en el cuerpo.
      ...creatorDocs.flatMap((c) => (c.image === undefined ? [c.body] : [`![](${c.image})`, c.body])),
    ].join('\n\n'),
    fm: membreteColeccion.length > 0 ? { ...fmBase, letterhead: membreteColeccion } : fmBase,
    docDir: dirname(doc.filePath),
    pageDimensions: renderCtx.pageDimensions ?? detectPageSize([]),
    cropActive: renderCtx.cropActive,
    pdfxActive: renderCtx.pdfxActive,
    outSlug: outputs.outSlug,
    dirs: {
      pdf: outputs.outBase(ASSETS_PDF_IMAGES_DIR),
      web: outputs.outBase(ASSETS_IMAGES_DIR),
      epub: join(ctx.cwd, '.iteraciones', 'tmp', 'epub-images', outputs.dir === '.' ? '' : outputs.dir, outputs.outSlug),
    },
    wants: { pdf: active.latex || active.pdf, web: active.html || active.epub || active.markdown, epub: active.epub },
    // Las imágenes de las tarjetas de una colección no viven en su cuerpo.
    extraImages: [
      ...(collectionEntries.length > 0 || extraEntries.length > 0 ? imagenesDeLasTarjetas([...collectionEntries, ...extraEntries], ctx.cwd) : []),
      ...(doc.frontmatter.type === 'creator' ? retratoDeLaPagina(outputs.fm, dirname(doc.filePath)) : []),
    ],
  });
}

/** Las páginas de un documento: la bio y las tarjetas, o las tarjetas solas. */
function paginasDeDocumento(args: {
  doc: BuildDocument;
  outSlug: string;
  entradas: CollectionEntry[];
  memberHrefs: Map<string, string>;
  pageContent: string;
  pageSize: number;
  creatorHrefs: Map<string, string>;
  dir: string;
  available?: Set<string>;
  discoveryIndex: Map<string, DiscoveryEntry>;
  imagenes: Map<string, string>;
}): string[] {
  const esCreadora = args.doc.frontmatter.type === 'creator';
  if (args.entradas.length === 0) return [args.pageContent];
  const paginas = collectionCardsPages(
    args.entradas,
    args.memberHrefs,
    esCreadora ? '' : args.pageContent,
    args.pageSize,
    args.creatorHrefs,
    args.dir,
    args.available,
    false,
    args.discoveryIndex,
    { path: args.doc.relativePath, outSlug: args.outSlug },
    args.imagenes,
  );
  if (esCreadora) {
    const bio = splitFrontmatter(args.pageContent).body.trim();
    if (bio !== '') paginas[0] = `${bio}\n\n${paginas[0] ?? ''}`;
  }
  return paginas;
}

async function emitCollectionHtml(
  doc: BuildDocument,
  outputs: DocumentOutputs,
  collectionEntries: CollectionEntry[],
  creatorDocs: CreatorDoc[],
  entradasCreadora: CollectionEntry[],
  content: string,
  renderCtx: RenderContext,
  exportCtx: ExportContext,
  formatWorkSets: FormatWorkSets,
  discoveryIndex: Map<string, DiscoveryEntry>,
  mergedFm: Record<string, unknown>,
  docDir: string,
  webMap: Map<string, string>,
  creatorLinks: { name: string; url: string }[],
): Promise<void> {
  const { ctx, plan, formatCfg } = renderCtx;
  if (!(plan.activeFormats.html && formatWorkSets.htmlPaths.has(doc.relativePath) && docProducesFormat(doc.frontmatter.type, 'html'))) return;

  const entradasTarjetas = doc.frontmatter.type === 'creator' ? entradasCreadora : collectionEntries;
  const memberHrefs = memberHtmlHrefs(doc.relativePath, entradasTarjetas, discoveryIndex);
  const hrefsCreadores = creatorHrefs(discoveryIndex, outputs.dir);
  const pageSize = formatCfg?.html?.pageSize ?? DEFAULT_HTML_FORMAT.pageSize;
  const available = availableDefaultListSlugs(discoveryIndex);
  const esMenu = doc.frontmatter.type === 'menu';
  const enlaces = enlacesDelMenu(discoveryIndex);
  const menu = esMenu ? undefined : menuCardHtml(enlaces, outputs.dir, formatCfg?.html?.site?.title ?? 'iteraciones');
  const pageContent = esMenu
    ? [splitFrontmatter(content).body.trim(), menuPageMarkdown(enlaces, outputs.dir)].filter((parte) => parte !== '').join('\n\n')
    : content;
  const paginas = paginasDeDocumento({
    doc,
    outSlug: outputs.outSlug,
    entradas: entradasTarjetas,
    memberHrefs,
    pageContent,
    pageSize,
    creatorHrefs: hrefsCreadores,
    dir: outputs.dir,
    available,
    discoveryIndex,
    imagenes: hrefsDeImagenes(webMap, ctx.outputDir, outputs.dir),
  });
  assertPaginasLibres(doc.relativePath, outputs.dir, outputs.outSlug, paginas.length, discoveryIndex);

  const imagePaths = await writeImagePaths(doc, ctx.cwd, 'html', webMap, docDir, true);
  const imagenes = hrefsDeImagenes(webMap, ctx.outputDir, outputs.dir);
  const { top: anunciosTop, bottom: anunciosBottom } = await anunciosDeLaPagina({
    discoveryIndex,
    cwd: ctx.cwd,
    dir: outputs.dir,
    docPath: doc.relativePath,
    available,
    creatorHrefs: hrefsCreadores,
    imagenes,
    outputDir: ctx.outputDir,
    announcementImages: renderCtx.announcementImages,
    filters: exportCtx.filters,
    imagePaths,
    sourcePath: doc.filePath,
  });
  const esTexto = doc.frontmatter.type === undefined || doc.frontmatter.type === 'file';
  const palabrasClave = esTexto ? palabrasClaveDe(doc.relativePath, outputs.dir, discoveryIndex) : [];
  const esCreadora = doc.frontmatter.type === 'creator';
  const duenoRedes = String(outputs.fm.name ?? outputs.fm.title ?? '');
  const extras = await buildExtrasHtml({
    creatorDocs,
    contenedores: contenedoresDe(doc, outputs.dir, discoveryIndex),
    palabrasClave,
    redesCreador: esCreadora ? creatorLinks : [],
    duenoRedes,
    creatorHrefs: hrefsCreadores,
    filters: exportCtx.filters,
    imagePaths,
    imagenes,
    sourcePath: doc.filePath,
    dir: outputs.dir,
    available,
  });
  // Las redes de la creadora van en su tarjeta, no al inicio del cuerpo.
  const contenidos = paginas;
  const covers = htmlCoverUrls(mergedFm, docDir, webMap);
  const indices = indicesDeColeccion(doc, outputs, collectionEntries, memberHrefs, pageSize, ctx.siteConfig);

  await emitHtmlPage(
    doc,
    outputs,
    renderCtx,
    exportCtx,
    discoveryIndex,
    imagePaths,
    contenidos,
    hrefsCreadores,
    extras,
    undefined,
    covers,
    indices,
    retratoDePaginaHref(outputs.fm, webMap, docDir, ctx.outputDir, outputs.dir),
    menu,
    anunciosTop,
    anunciosBottom,
  );
  await removeExtraHtmlPages(ctx.outputDir, outputs.dir, outputs.outSlug, paginas.length, discoveryIndex);
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

  const docDir = dirname(doc.filePath);
  const mergedFm = mergeConfigImages(outputs.fm, formatCfg?.pdf, ctx.siteConfig, ctx.cwd);
  const entradasCreadora = doc.frontmatter.type === 'creator' ? await entradasDeLaCreadora(doc, outputs, discoveryIndex, ctx.cwd) : [];
  const images = await preprocessDocImages(doc, outputs, collectionEntries, creatorDocs, content, renderCtx, entradasCreadora);
  const pdfImages = images.pdf ?? { imageMap: new Map<string, string>(), processedFiles: [] };
  const webMap = images.web?.imageMap ?? new Map<string, string>();
  const epubMap = images.epub?.imageMap ?? new Map<string, string>();
  const relImageMap = relImageMapFor(webMap);

  const fmAssets = rewriteFmImagePaths(outputs.fm, relImageMap, docDir);

  const creatorLinks = doc.frontmatter.type === 'creator' ? getCreatorLinks(outputs.fm) : [];
  const isCollection = doc.frontmatter.type === 'collection';

  if (
    (activeFormats.latex || activeFormats.pdf) &&
    formatWorkSets.latexPaths.has(doc.relativePath) &&
    docProducesFormat(doc.frontmatter.type, 'latex')
  ) {
    const pageNumber = (outputs.fm.pageNumber ?? formatCfg?.pdf?.pageNumber ?? ctx.siteConfig.pageNumber) as string | undefined;
    const base = collectionBaseContent(collectionEntries, 'latex', content, pageNumber, undefined, pdfImages.imageMap);
    const docsAutoras = isCollection ? await resolveCollectionCreatorDocs(doc, discoveryIndex, ctx.cwd, outputs.fm) : creatorDocs;
    const authorsBlock = await buildAuthorsLatex(docsAutoras, doc.filePath, exportCtx.filters, esFile, nombresCreadoras.length);
    await emitLatexAndQueuePdf(
      doc,
      { ...outputs, content: prependLinksLatex(base, creatorLinks) },
      renderCtx,
      exportCtx,
      formatWorkSets,
      pdfImages,
      authorsBlock,
    );
  }

  const exportDoc = assembleExportDocument(doc, renderCtx.lang, exportCtx.globalBibliography, exportCtx.globalCsl);

  await emitCollectionHtml(
    doc,
    outputs,
    collectionEntries,
    creatorDocs,
    entradasCreadora,
    content,
    renderCtx,
    exportCtx,
    formatWorkSets,
    discoveryIndex,
    mergedFm,
    docDir,
    webMap,
    creatorLinks,
  );

  if (activeFormats.epub && formatWorkSets.epubPaths.has(doc.relativePath) && docProducesFormat(doc.frontmatter.type, 'epub')) {
    const base = collectionBaseContent(collectionEntries, 'html', content);
    const imagePaths = await writeImagePaths(doc, ctx.cwd, 'epub', epubMap, docDir, false);
    const epubCover = epubCoverPath(mergedFm, docDir, epubMap);
    await convertToEpub(
      prependLinksMarkdown(base, creatorLinks),
      outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('epub')}`),
      exportDoc,
      exportCtx.filters,
      ctx.siteConfig.toc,
      outputs.fm,
      await collectionPandocInput(doc, ctx.cwd, outputs.outSlug, 'epub'),
      imagePaths,
      epubCover,
      ctx.cwd,
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
  const autoras = isCollection ? await resolveCollectionCreatorDocs(doc, discoveryIndex, ctx.cwd, outputs.fm) : [];

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
    autoras,
  });
}

export function availableDefaultListSlugs(discoveryIndex: Map<string, DiscoveryEntry>): Set<string> {
  const slugs = new Set<string>();
  for (const lista of DEFAULT_LISTS) {
    if (lista.type === 'all') {
      if (discoveryIndex.size > 0 && !discoveryIndex.has('index.md')) slugs.add(lista.slug);
    } else {
      if (miembrosDeUnType(discoveryIndex, lista.type).length > 0) slugs.add(lista.slug);
    }
  }
  return slugs;
}

function tipoDe(entry: DiscoveryEntry): string {
  return entry.type ?? (entry.files && entry.files.length > 0 ? 'collection' : 'file');
}

/** La fecha del `date` del frontmatter o, si no existe, la última modificación del archivo. */
function placementDe(entry: CollectionEntry, discoveryIndex: Map<string, DiscoveryEntry>): 'top' | 'bottom' {
  return discoveryIndex.get(entry.file)?.fm?.placement === 'bottom' ? 'bottom' : 'top';
}

function fechaOrdenable(entry: DiscoveryEntry | undefined): number {
  if (entry?.date !== undefined) {
    const fecha = Date.parse(entry.date);
    if (!Number.isNaN(fecha)) return fecha;
  }
  return entry?.mtime ?? 0;
}

/** Las listas por defecto se ordenan de lo más reciente a lo más antiguo. */
function miembrosDeUnType(discoveryIndex: Map<string, DiscoveryEntry>, type: string): string[] {
  const rutas = [...discoveryIndex.entries()]
    .filter(([, entry]) => (type === 'all' ? tipoDe(entry) !== 'menu' && tipoDe(entry) !== 'announcement' : tipoDe(entry) === type))
    .map(([ruta]) => ruta);
  // Las creadoras van siempre por nombre, sin importar la fecha.
  if (type === 'creator') {
    const nombre = (ruta: string): string => discoveryIndex.get(ruta)?.title ?? ruta;
    return rutas.sort((a, b) => nombre(a).localeCompare(nombre(b), 'es') || a.localeCompare(b));
  }
  return rutas.sort((a, b) => {
    const diferencia = fechaOrdenable(discoveryIndex.get(b)) - fechaOrdenable(discoveryIndex.get(a));
    return diferencia !== 0 ? diferencia : a.localeCompare(b);
  });
}

/** El retrato declarado en el frontmatter de una creadora, ya resuelto. */
function retratoDeLaPagina(fm: Record<string, unknown>, docDir: string): string[] {
  const retrato = fmTrimmedString(fm.image);
  if (retrato === undefined) return [];
  return [isAbsolute(retrato) ? retrato : resolve(docDir, retrato)];
}

function retratoDePaginaHref(
  fm: Record<string, unknown>,
  webMap: Map<string, string>,
  docDir: string,
  outputDir: string,
  dir: string,
): string | undefined {
  const raw = fmTrimmedString(fm.image);
  if (raw === undefined) return undefined;
  const abs = isAbsolute(raw) ? raw : resolve(docDir, raw);
  const processed = webMap.get(abs);
  if (processed === undefined || processed === abs) return undefined;
  return `./${posix(relative(join(outputDir, dir), processed))}`;
}

function imagenesDeLasTarjetas(entradas: CollectionEntry[], cwd: string): string[] {
  const imagenes: string[] = [];
  for (const entrada of entradas) {
    const dir = entrada.dirAbs ?? dirname(join(cwd, entrada.file));
    const fragmento = extractFragment(entrada.body);
    if (fragmento !== '') imagenes.push(...scanInlineImages(fragmento, dir));
    // La imagen de cabecera ya no vive en el fragmento: se procesa aparte.
    const src = primeraImagenDelCuerpo(entrada.body);
    if (src !== undefined) imagenes.push(isAbsolute(src) ? src : resolve(dir, src));
    if (entrada.type === 'creator' && entrada.image !== undefined) {
      imagenes.push(isAbsolute(entrada.image) ? entrada.image : resolve(dir, entrada.image));
    }
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
  const available = availableDefaultListSlugs(discoveryIndex);

  const listas = [];
  for (const lista of DEFAULT_LISTS) {
    const miembros = miembrosDeUnType(discoveryIndex, lista.type);
    const entradas = await readCollectionEntries(miembros, `${lista.slug}.md`, [cwd], true);
    listas.push({ ...lista, miembros, entradas });
  }

  const procesadas = await processWebImages(
    imagenesDeLasTarjetas(
      listas.flatMap((l) => l.entradas),
      cwd,
    ),
    join(outputDir, ASSETS_IMAGES_DIR),
    imageNamerFor('lista', 'webp'),
    renderCtx.pdfxActive,
  );

  for (const { slug, title, type, miembros, entradas, description } of listas) {
    // Las listas por defecto sólo se escriben si hay elementos que listar.
    if (miembros.length === 0) continue;
    const dueno = htmlOwner(discoveryIndex, '.', slug);
    if (dueno !== undefined) {
      logWarning(
        `no se escribió la lista de ${type} porque "${slug}.html" es el archivo de "${dueno}": renombra ese documento (con "slug:" en su frontmatter) para que la lista exista`,
        'build',
      );
      continue;
    }

    const memberHrefs = memberHtmlHrefs(`${slug}.md`, entradas, discoveryIndex);
    const paginas = collectionCardsPages(
      entradas,
      memberHrefs,
      description ?? '',
      pageSize,
      hrefsCreadores,
      '.',
      available,
      true,
      discoveryIndex,
      {
        path: `${slug}.md`,
        outSlug: slug,
      },
      hrefsDeImagenes(procesadas.imageMap, outputDir, '.'),
    );
    // La paginación la inserta emitHtmlPage; no debe duplicarse aquí.
    const contenidos = paginas;

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
    const menu = menuCardHtml(enlacesDelMenu(discoveryIndex), '.', formatCfg?.html?.site?.title ?? 'iteraciones');
    const { top: anunciosTop, bottom: anunciosBottom } = await anunciosDeLaPagina({
      discoveryIndex,
      cwd,
      dir: '.',
      available,
      creatorHrefs: hrefsCreadores,
      imagenes: hrefsDeImagenes(procesadas.imageMap, outputDir, '.'),
      outputDir,
      announcementImages: renderCtx.announcementImages,
      filters: exportCtx.filters,
      imagePaths,
      sourcePath: doc.filePath,
    });
    await emitHtmlPage(
      doc,
      outputs,
      renderCtx,
      exportCtx,
      discoveryIndex,
      imagePaths,
      contenidos,
      hrefsCreadores,
      '',
      'Lista',
      undefined,
      undefined,
      undefined,
      menu,
      anunciosTop,
      anunciosBottom,
    );
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
  // El menú del sitio vive siempre en menu.html.
  const outSlug = doc.frontmatter.type === 'menu' ? 'menu' : htmlSlugFor(doc.relativePath, slug);
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
