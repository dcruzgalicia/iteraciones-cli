import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_FORMAT } from '../config/site-config.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { fmString, fmStringList, fmTrimmedString, resolveBooleanField, resolveMetadataField, resolveStringField } from '../lib/frontmatter-fields.js';
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
import { luaFilterArgs, MBOX_HELPERS_FILTER } from './filter-resolver.js';
import { CHIP_OUTLINE_CLASSES, creatorPortraitHtml, type HtmlPageVars, logoBlockHtml } from './html-composer.js';
import {
  type DocumentImages,
  imageNamerFor,
  imagePathsMap,
  LETTERHEAD_HEIGHT_MM,
  type ProcessedImages,
  parseLetterheadHeight,
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
import { fechaOrdenable } from './list-filter.js';
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

interface TypeMeta {
  chip: string;
  contentChip?: string;
  memberLabel?: string;
  cta?: string;
}

const TYPE_META: Record<string, TypeMeta> = {
  file: { chip: 'Texto', contentChip: 'Contenido', memberLabel: 'Texto', cta: 'Leer texto completo' },
  collection: { chip: 'Colección', memberLabel: 'Colección', cta: 'Ver colección completa' },
  creator: { chip: 'Colaboradora', contentChip: 'Bio', memberLabel: 'Colaboradora', cta: 'Ver página de la creadora' },
  list: { chip: 'Lista', memberLabel: 'Lista', cta: 'Ver lista completa' },
  menu: { chip: 'Menú', contentChip: 'Menú' },
  announcement: { chip: 'Anuncio', memberLabel: 'Anuncio', cta: 'Leer anuncio' },
  all: { chip: 'Publicaciones' },
};

function docChipLabel(type: string | undefined): string {
  return TYPE_META[type ?? 'file']?.chip ?? 'Texto';
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

async function writePathsFile(path: string, imageMap: Map<string, string>, docDir: string, relativize: boolean): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(imagePathsMap(imageMap, docDir, relativize))}\n`);
  return path;
}

export async function writeImagePaths(
  doc: BuildDocument,
  cwd: string,
  format: 'latex' | 'html' | 'epub',
  imageMap: Map<string, string>,
  docDir: string,
  relativize: boolean,
): Promise<string> {
  return writePathsFile(resolve(cwd, '.iteraciones', 'paths', `${doc.relativePath}.${format}.json`), imageMap, docDir, relativize);
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
  const lowertitlebackLicencia = licenciaLowertitlebackPorDefecto(fm, formatCfg?.pdf, ctx.siteConfig, dirname(doc.filePath), doc.frontmatter.type);
  const pdfCfg = lowertitlebackLicencia === undefined ? formatCfg?.pdf : { ...(formatCfg?.pdf ?? {}), lowertitleback: lowertitlebackLicencia };
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
    formatCfg: pdfCfg,
    biblatexAvailable: exportCtx.biblatexAvailable,
    warnedLangs,
    images,
    cwd: ctx.cwd,
  });
  const xmp = renderCtx.pdfxActive ? xmpMetadataFor(fm, lang, formatCfg?.pdf, ctx.siteConfig) : undefined;

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

function epubCoverPath(fm: Record<string, unknown>, docDir: string, epubMap: Map<string, string>): string | undefined {
  const raw = fm.frontCover;
  if (typeof raw !== 'string' || raw === '') return undefined;
  const abs = isAbsolute(raw) ? raw : resolve(docDir, raw);
  const processed = epubMap.get(abs);
  return processed !== undefined && processed !== abs ? processed : undefined;
}

function contentChipPara(type: string | undefined): string | undefined {
  return type === undefined || type === 'file' ? 'Contenido' : TYPE_META[type]?.contentChip;
}

function docChipHrefPara(dir: string, type: string | undefined, available?: Set<string>): string | undefined {
  const slug = defaultListSlug(type);
  if (slug === undefined) return undefined;
  if (available !== undefined && !available.has(slug)) return undefined;
  return defaultListHref(dir, type);
}

function logoVars(logo: LogoAsset | undefined, dir: string, logoSize: string | undefined): Pick<HtmlPageVars, 'logoBlock' | 'favicon'> {
  if (logo === undefined) return {};
  const href = logo.kind === 'file' ? relativeHref(dir, logo.path) : '';
  return {
    logoBlock: logoBlockHtml(href, logoSize, logo.kind === 'inline' ? logo.svg : undefined),
    favicon: logo.favicon === undefined ? undefined : `<link rel="icon" href="${relativeHref(dir, logo.favicon)}">`,
  };
}

function opcional(valor: string | undefined): string | undefined {
  return valor === '' ? undefined : valor;
}

function tarjetasDeSitio(args: {
  siteConfig: SiteConfig;
  dir: string;
  license?: string | false;
  menuHeader?: string;
  menuFooterPlain?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
}): Pick<HtmlPageVars, 'license' | 'menuHeader' | 'menuFooterPlain' | 'announcementsTop' | 'announcementsBottom'> {
  return {
    license: licenciaHtml(args.siteConfig, args.dir, args.license),
    menuHeader: args.menuHeader,
    menuFooterPlain: args.menuFooterPlain,
    announcementsTop: opcional(args.announcementsTop),
    announcementsBottom: opcional(args.announcementsBottom),
  };
}

function cuando(condicion: boolean, valor: string): string | undefined {
  return condicion ? valor : undefined;
}

function formatosOpcionales(formats: HtmlPageVars['formats']): HtmlPageVars['formats'] {
  return formats !== undefined && formats.length > 0 ? formats : undefined;
}

function esSubjectDuplicado(subject: string | undefined, keywords: string[]): boolean {
  if (subject === undefined) return false;
  const normalizado = subject.trim().toLocaleLowerCase('es');
  if (keywords.includes(normalizado)) return true;
  const partes = subject
    .split(/[,;]/)
    .map((parte) => parte.trim().toLocaleLowerCase('es'))
    .filter(Boolean);
  return partes.length > 0 && partes.every((parte) => keywords.includes(parte));
}

function subjectVisible(subject: string | undefined, keywords: string[]): string | undefined {
  return esSubjectDuplicado(subject, keywords) ? undefined : subject;
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
  menuHeader?: string;
  menuFooterPlain?: string;
  pageChips?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
  docChipHrefOverride?: string;
  contentChipOverride?: string;
  indiceColeccion?: string;
  creatorHrefs: Map<string, string>;
  extras: string;
  sidebarExtras: string;
  pagination: string;
  discoveryIndex: Map<string, DiscoveryEntry>;
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
    menuHeader,
    menuFooterPlain,
    pageChips,
    announcementsTop,
    announcementsBottom,
    docChipHrefOverride,
    contentChipOverride,
    indiceColeccion,
    creatorHrefs,
    extras,
    sidebarExtras,
    pagination,
    discoveryIndex,
  } = args;
  const { ctx, lang, formatCfg } = renderCtx;
  const htmlConfig = formatCfg?.html;
  const { dir, slug, fm } = outputs;
  const titulo = doc.frontmatter.title || slug;
  const subject = htmlMetadataField(fm, htmlConfig, ctx.siteConfig, 'subject');
  const keywords = keywordsFromFm(fm).map((keyword) => keyword.trim().toLocaleLowerCase('es'));
  const siteTitle = fmString(htmlConfig?.site?.title, 'iteraciones');
  const showDates = fm.showDates === false ? false : fm.showDates === true ? true : htmlConfig?.site?.showDates === true;
  const esListaIndex = doc.relativePath === 'index.md' && doc.frontmatter.type === 'list';
  const esPaginaKeyword = doc.relativePath === `${KEYWORD_INDEX_SLUG}.md`;
  const esPaginaIndex = doc.relativePath === 'index.md';
  return {
    ...logoVars(renderCtx.logo, dir, htmlConfig?.site?.logoSize),
    title: titulo,
    siteTitle: fmString(htmlConfig?.site?.title, 'iteraciones'),
    tagline: fmString(htmlConfig?.site?.description, 'escribir, compartir, re-existir'),
    lang,
    theme: htmlConfig?.site?.theme,
    css: cuando(ctx.needsCss, relativeHref(dir, ASSETS_CSS_FILE)),
    iconTop: relativeHref(dir, `${ASSETS_IMAGES_DIR}/arrow-upward.webp`),
    keywords: opcional(keywordsFromFm(fm).join(', ')),
    authorMeta: doc.frontmatter.creator.join(', '),
    docTitle: cuando(doc.frontmatter.title !== undefined && doc.frontmatter.title !== TITULO_POR_DEFECTO, doc.frontmatter.title ?? ''),
    subtitle: doc.frontmatter.subtitle,
    date: formatHumanDate(doc.frontmatter.date),
    dateIso: opcional(doc.frontmatter.date),
    showDates,
    homeHref: cuando(hasHomePage, relativeHref(dir, 'index.html')),
    formats: formatosOpcionales(formats),

    titlehead: htmlMetadataField(fm, htmlConfig, ctx.siteConfig, 'titlehead'),
    subject: subjectVisible(subject, keywords),
    publishers: htmlMetadataField(fm, htmlConfig, ctx.siteConfig, 'publishers'),
    collectionCreatorPrefix: resolveStringField(fm, htmlConfig, ctx.siteConfig, 'collectionCreatorPrefix'),
    collectionCreator: nombresEnlazados(parseAuthors(resolveMetadataField(fm, htmlConfig, ctx.siteConfig, 'collectionCreator')), creatorHrefs),
    authors: nombresEnlazados(doc.frontmatter.creator, creatorHrefs),
    docChip: fmString(docChip, docChipLabel(doc.frontmatter.type)),
    contentChip: contentChipOverride ?? contentChipPara(doc.frontmatter.type),
    frontCover: covers?.front,
    backCover: covers?.back,
    creatorImage,
    creatorImageAlt: cuando(creatorImage !== undefined, `Retrato de ${titulo}`),
    ...tarjetasDeSitio({
      siteConfig: ctx.siteConfig,
      dir,
      license: licenciaOverride(fm),
      menuHeader,
      menuFooterPlain,
      announcementsTop,
      announcementsBottom,
    }),
    pageChips: opcional(pageChips),
    indiceColeccion,
    docChipHref: docChipHrefOverride ?? docChipHrefPara(dir, doc.frontmatter.type, available),
    extras: opcional(extras),
    sidebarExtras: opcional(sidebarExtras),
    recientes: opcional(esListaIndex ? '' : recentesCard(discoveryIndex, dir)),
    siteKeywords: opcional(
      siteKeywordsCard(
        discoveryIndex,
        dir,
        siteTitle,
        esPaginaKeyword ? undefined : keywordIndexHref(dir, discoveryIndex),
        esPaginaIndex ? undefined : relativeHref(dir, 'index.html'),
      ),
    ),
    pagination: opcional(pagination),
  };
}

export interface EmitHtmlPageArgs {
  doc: BuildDocument;
  outputs: DocumentOutputs;
  renderCtx: RenderContext;
  exportCtx: ExportContext;
  discoveryIndex: Map<string, DiscoveryEntry>;
  imagePaths?: string;
  paginas?: string[];
  creatorHrefs?: Map<string, string>;
  extras?: string | string[];
  sidebarExtras?: string;
  docChipOverride?: string;
  covers?: { front?: string; back?: string };
  indices?: string[];
  creatorImage?: string;
  menuHeader?: string;
  menuFooterPlain?: string;
  pageChips?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
  docChipHrefOverride?: string;
  contentChipOverride?: string;
}

export async function emitHtmlPage(args: EmitHtmlPageArgs): Promise<void> {
  const {
    doc,
    outputs,
    renderCtx,
    exportCtx,
    discoveryIndex,
    imagePaths,
    paginas,
    creatorHrefs = new Map(),
    extras = '',
    sidebarExtras = '',
    docChipOverride,
    covers,
    indices,
    creatorImage,
    menuHeader,
    menuFooterPlain,
    pageChips,
    announcementsTop,
    announcementsBottom,
    docChipHrefOverride,
    contentChipOverride,
  } = args;
  const { ctx, plan } = renderCtx;
  const { outBase, outSlug, content } = outputs;
  const cwd = ctx.cwd;

  const formats = formatLinksFor(plan, outSlug, doc.frontmatter.type);
  const hasHomePage = discoveryIndex.has('index.md') || discoveryIndex.size > 0;
  const available = availableDefaultListSlugs(discoveryIndex);

  const htmlType: 'file' | 'collection' | 'creator' | 'list' =
    doc.frontmatter.type === 'collection' || doc.frontmatter.type === 'creator' || doc.frontmatter.type === 'list' ? doc.frontmatter.type : 'file';
  const contenidos = paginas ?? [content];
  for (const [indice, contenido] of contenidos.entries()) {
    const extraPagina = Array.isArray(extras) ? (extras[indice] ?? '') : extras;
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
        menuHeader,
        menuFooterPlain,
        pageChips,
        announcementsTop,
        announcementsBottom,
        docChipHrefOverride,
        contentChipOverride,
        indiceColeccion: indices?.[indice],
        creatorHrefs,
        extras: extraPagina,
        sidebarExtras,
        pagination,
        discoveryIndex,
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
  date?: string;
  type: string | undefined;
  lineLength: number | undefined;
  pages: number | undefined;

  letterhead?: string[];

  letterheadHeight?: string;

  dirAbs?: string;

  image?: string;
  body: string;
};

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
  rootFiles?: string[];

  memberSlugs?: Map<string, string>;

  merge: boolean;
  entries: CollectionEntry[];

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

    if (membrete.length > 0) {
      parts.push(`\\setlength{\\letterheadheight}{${parseLetterheadHeight(e.letterheadHeight)}mm}`);
      parts.push(`\\letterheadsetup{${membrete.join(',')}}`);
    }
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

function htmlPathFor(relativePath: string, slug: string | undefined): string {
  return posix(join(dirname(relativePath), `${htmlSlugFor(relativePath, slug)}.html`));
}

export function memberHtmlHrefs(collectionPath: string, entries: CollectionEntry[], slugIndex: Map<string, DiscoveryEntry>): Map<string, string> {
  const dir = dirname(collectionPath);
  const hrefs = new Map<string, string>();
  for (const e of entries) {
    const slug = slugIndex.get(e.file)?.slug;
    if (slug === undefined) continue;
    const html = htmlPathFor(e.file, slug);
    hrefs.set(e.file, relativeHref(dir, html));
  }
  return hrefs;
}

function printableEntries<T extends { type: string | undefined }>(entries: T[]): T[] {
  return entries.filter((e) => e.type !== 'intervention');
}

export function creatorHrefs(discoveryIndex: Map<string, DiscoveryEntry>, fromDir: string): Map<string, string> {
  const hrefs = new Map<string, string>();
  for (const [ruta, entry] of discoveryIndex) {
    if (entry.type !== 'creator') continue;
    const nombre = entry.fm?.name ?? entry.fm?.title;
    if (typeof nombre !== 'string' || nombre.trim() === '') continue;
    if (hrefs.has(nombre)) continue;
    const html = htmlPathFor(ruta, entry.slug);
    hrefs.set(nombre, relativeHref(fromDir, html));
  }
  return hrefs;
}

function escapeMarkdown(texto: string): string {
  return texto.replace(/([[\]])/g, '\\$1');
}

export function nombresEnlazados(nombres: string[], hrefs: Map<string, string>): string[] {
  return nombres.map((nombre) => {
    const href = hrefs.get(nombre);
    if (href === undefined) return nombre;
    return `[${escapeMarkdown(nombre)}](<${href}>)`;
  });
}

function nombreEnlazadoHtml(nombre: string, hrefs: Map<string, string>, tono: 'accent' | 'gris' | 'plano' = 'accent'): string {
  const href = hrefs.get(nombre);
  if (href === undefined) return nombre;
  if (tono === 'plano') return `<a href="${href}">${nombre}</a>`;
  const clases =
    tono === 'gris'
      ? 'py-1 text-stone-600 no-underline underline-offset-4 hover:underline dark:text-stone-400'
      : 'py-1 text-accent-700 no-underline underline-offset-4 hover:underline dark:text-accent-300';
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

  const conImagenes = entries.map((entrada) => ({ ...entrada, body: absolutizaImagenes(entrada.body, entrada.dirAbs) }));
  const sections = collectionBaseContent(conImagenes, 'latex', content);
  return body.trim() === '' ? sections : `${sections}\n\n${body}`;
}

const PAGINATION_BUTTON_CLASSES =
  'inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-accent-500/40 bg-accent-500/10 px-2 text-[11px] font-semibold text-accent-800 no-underline transition-colors duration-200 hover:border-accent-500 hover:bg-accent-500/20 sm:px-2.5 sm:text-xs lg:px-3 lg:text-sm dark:border-accent-400/40 dark:bg-accent-500/10 dark:text-accent-300 dark:hover:bg-accent-500/20';

const PAGINATION_ACTIVE_CLASSES =
  'inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-accent-500 bg-accent-500/20 px-2 text-[11px] font-semibold text-accent-900 sm:px-2.5 sm:text-xs lg:px-3 lg:text-sm dark:text-accent-100';

const PAGINATION_NAV_CLASSES = 'mt-8 flex flex-wrap items-center justify-center gap-2 sm:mt-10 lg:mt-12';

function pageSlug(outSlug: string, pagina: number): string {
  return pagina === 1 ? outSlug : `${outSlug}-${pagina}`;
}

function ventanaDePaginas(pagina: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const numeros = new Set([1, total, pagina - 1, pagina, pagina + 1]);
  if (pagina <= 3) for (const n of [2, 3, 4]) numeros.add(n);
  if (pagina >= total - 2) for (const n of [total - 1, total - 2, total - 3]) numeros.add(n);
  const ordenados = [...numeros].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const salida: Array<number | '…'> = [];
  for (const [i, n] of ordenados.entries()) {
    if (i > 0 && n - (ordenados[i - 1] as number) > 1) salida.push('…');
    salida.push(n);
  }
  return salida;
}

export function paginationNav(outSlug: string, pagina: number, total: number): string {
  if (total <= 1) return '';
  const enlace = (n: number, texto: string): string =>
    `<a href="./${pageSlug(outSlug, n)}.html" class="${PAGINATION_BUTTON_CLASSES}" aria-label="${texto}">${texto}</a>`;
  const actual = (n: number): string => `<span aria-current="page" class="${PAGINATION_ACTIVE_CLASSES}">${n}</span>`;
  const anterior = pagina > 1 ? enlace(pagina - 1, '← Anterior') : '';
  const siguiente = pagina < total ? enlace(pagina + 1, 'Siguiente →') : '';
  const numeros = ventanaDePaginas(pagina, total)
    .map((n) => (n === '…' ? '<span class="px-1 text-stone-500 dark:text-stone-400">…</span>' : n === pagina ? actual(n) : enlace(n, String(n))))
    .join('');
  return `<nav class="${PAGINATION_NAV_CLASSES}" aria-label="Paginación">${anterior}${numeros}${siguiente}</nav>`;
}

const CARD_IMAGE_CLASSES = 'mt-0! mb-3! flex h-[100px] w-full items-center justify-center overflow-hidden rounded-tr-xl rounded-bl-xl sm:mb-4!';
const CARD_IMAGE_IMG_CLASSES = 'm-0! block h-full w-full object-cover';
const CARD_IMAGE_LINK_CLASSES = 'block h-full w-full rounded-tr-xl rounded-bl-xl';
const PORTRAIT_WRAPPER_CLASSES = 'mb-6 flex justify-center';
const PORTRAIT_CLASSES = 'm-0! block rounded-full object-cover';
const PORTRAIT_LINK_CLASSES = 'block overflow-hidden rounded-full [clip-path:circle(50%)]';

const IMAGEN_MD_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/;
const IMAGEN_HTML_RE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i;

export function primeraImagenDelCuerpo(body: string): string | undefined {
  const md = IMAGEN_MD_RE.exec(body);
  const html = IMAGEN_HTML_RE.exec(body);
  if (md === null && html === null) return undefined;
  if (md === null) return html?.[1];
  if (html === null) return md[1];
  return (md.index as number) <= (html.index as number) ? md[1] : html[1];
}

export function hrefsDeImagenes(imageMap: Map<string, string>, outputDir: string, dir: string): Map<string, string> {
  const base = join(outputDir, dir);
  const hrefs = new Map<string, string>();
  for (const [abs, processed] of imageMap) {
    if (processed === abs) continue;
    hrefs.set(abs, `./${posix(relative(base, processed))}`);
  }
  return hrefs;
}

function figuraDeTarjeta(href: string, enlace: string | undefined, titulo: string): string {
  const img = `<img src="${href}" alt="" class="${CARD_IMAGE_IMG_CLASSES}">`;
  const dentro =
    enlace === undefined
      ? img
      : `<a href="${enlace}" aria-label="Imagen de ${Bun.escapeHTML(titulo)}" class="${CARD_IMAGE_LINK_CLASSES}">${img}</a>`;
  return `<figure class="${CARD_IMAGE_CLASSES}">${dentro}</figure>`;
}

function retratoDeCreadora(href: string, nombre: string, enlace?: string): string {
  const img = `<img src="${href}" alt="Retrato de ${Bun.escapeHTML(nombre)}" class="${PORTRAIT_CLASSES}" style="width:100px;height:100px">`;
  const dentro =
    enlace === undefined
      ? img
      : `<a href="${enlace}" aria-label="Ver la biografía de ${Bun.escapeHTML(nombre)}" class="${PORTRAIT_LINK_CLASSES}">${img}</a>`;
  return `<div class="${PORTRAIT_WRAPPER_CLASSES}">${dentro}</div>`;
}

function collectionIndices(entries: CollectionEntry[], memberHrefs: Map<string, string>, pageSize: number): string[] {
  const imprimibles = printableEntries(entries);
  if (imprimibles.length === 0) return [];
  const total = Math.ceil(imprimibles.length / pageSize);
  const items = imprimibles
    .map((entrada) => {
      const href = memberHrefs.get(entrada.file);
      const titulo = Bun.escapeHTML(entrada.title || TITULO_POR_DEFECTO);
      return href === undefined
        ? `<li>${titulo}</li>`
        : `<li><a href="${href}" class="text-accent-700 no-underline underline-offset-4 hover:underline dark:text-accent-300">${titulo}</a></li>`;
    })
    .join('');
  const indice = `<div class="min-w-0" id="indice-completo"><nav class="contenido-tamano contenido-compacto relative rounded-tr-xl rounded-bl-xl tarjeta p-4 sm:p-6 ring-1 ring-inset ring-stone-300/60 dark:ring-stone-600/40"><h2 class="inline-flex h-7 items-center rounded-full border border-accent-500/30 bg-accent-500/12 px-2.5 text-[11px] font-normal uppercase tracking-wide leading-none mt-0 mb-6 text-accent-800 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:text-accent-300">Índice</h2><ol class="m-0 list-decimal space-y-2 ps-6">${items}</ol></nav></div>`;
  return Array.from({ length: total }, () => indice);
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
  return collectionIndices(entries, memberHrefs, pageSize);
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

const CARD_WRAPPER = '<div class="min-w-0">';

const CARD_PREVIEW_MAX_WORDS = 150;

const CARD_TEXT_CLASSES =
  'prose prose-base dark:prose-invert max-w-none contenido-tamano contenido-compacto [--tw-prose-links:var(--color-accent-700)] [--tw-prose-invert-links:var(--color-accent-300)] sm:prose-lg md:prose-xl lg:prose-2xl';

const COLLECTION_CARD_CLASSES = `tarjeta-fragmento relative flex h-[30rem] flex-col overflow-hidden rounded-tr-xl rounded-bl-xl tarjeta p-4 ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 [overflow-wrap:anywhere] [&_h3]:line-clamp-2 [&>h2]:line-clamp-1 sm:h-[32rem] sm:p-5 lg:h-[34rem] lg:p-6 ${CARD_TEXT_CLASSES}`;

const PILL_BASE =
  'not-prose inline-flex h-7 items-center rounded-full border border-accent-500/30 bg-accent-500/12 px-2.5 text-[11px] font-normal uppercase tracking-wide leading-none text-accent-800 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:text-accent-300';

const MEMBER_PILL_CLASSES = `${PILL_BASE} mt-0 mb-6`;

const EXTRA_PILL_CLASSES = `${PILL_BASE} mt-0 mb-0`;
const EXTRA_PILL_OUTLINE_CLASSES =
  'not-prose inline-flex h-7 items-center rounded-full border border-accent-500/30 bg-transparent px-2.5 text-[11px] font-normal uppercase tracking-wide leading-none text-accent-800 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:text-accent-300';

const EXTRA_PILL_SPACED_CLASSES = `${PILL_BASE} mt-0 mb-6`;

const MEMBER_BADGE_CLASSES =
  'inline-block shrink-0 rounded-full border border-stone-300 bg-stone-200/70 px-2 py-1 font-semibold text-xs leading-none mt-0 text-stone-600 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-300';

function memberTypeLabel(type: string | undefined): string {
  return TYPE_META[type ?? 'file']?.memberLabel ?? 'Texto';
}

const CHIP_HOVER_CLASSES = 'transition-colors duration-200 hover:underline';

const CHIP_LINK_CLASSES = 'text-inherit no-underline transition-colors duration-200 hover:underline';

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
  'py-1 no-underline underline-offset-4 decoration-current/40 transition-colors duration-200 hover:underline hover:decoration-current';

const CARD_CTA_CLASSES =
  'inline-flex h-7 items-center gap-2 rounded-full border border-accent-500/50 bg-accent-500/20 px-2.5 text-[11px] font-semibold text-accent-800 no-underline transition-colors duration-200 hover:border-accent-500 hover:bg-accent-500/30 hover:text-accent-900 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-accent-400/50 dark:bg-accent-500/20 dark:text-accent-200 dark:hover:bg-accent-500/30';

const MENU_BUTTON_CLASSES =
  'inline-flex h-7 items-center gap-2 rounded-full border border-accent-500/30 bg-accent-500/12 px-2.5 text-[11px] font-semibold text-accent-800 no-underline transition-colors duration-200 hover:border-accent-500 hover:bg-accent-500/20 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-accent-400/30 dark:bg-accent-500/12 dark:text-accent-300 dark:hover:bg-accent-500/20';

const MENU_LINK_CLASSES =
  'inline-flex h-7 items-center gap-2 rounded-full border border-accent-500/40 bg-transparent px-2.5 text-[11px] font-semibold text-accent-800 no-underline transition-colors duration-200 hover:border-accent-500 hover:bg-accent-500/10 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-accent-400/40 dark:bg-transparent dark:text-accent-300 dark:hover:bg-accent-500/10';

const PAGE_CHIP_BASE =
  'inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wide leading-none no-underline transition-colors duration-200 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm';
const PAGE_COLLECTION_CHIP_CLASSES = `${PAGE_CHIP_BASE} border-accent-500/50 bg-transparent text-accent-800 hover:border-accent-500 hover:underline dark:border-accent-400/50 dark:text-accent-200`;
const PAGE_KEYWORD_CHIP_CLASSES = `${PAGE_CHIP_BASE} border-stone-500/60 bg-transparent text-stone-600 hover:border-stone-600 hover:underline dark:border-stone-400/60 dark:text-stone-300`;
const RECENTES_LIMIT = 5;
const KEYWORD_INDEX_SLUG = 'keyword';
const SIDEBAR_KEYWORD_CHIP_CLASSES =
  'not-prose inline-flex h-7 items-center gap-1.5 rounded-full border border-stone-500/60 bg-transparent px-2.5 text-[11px] font-semibold uppercase tracking-wide leading-none no-underline text-stone-600 transition-colors duration-200 hover:border-stone-600 hover:underline sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-stone-400/60 dark:text-stone-300';
const KEYWORD_BADGE_CLASSES =
  'inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-bold leading-none text-white dark:bg-accent-500 dark:text-stone-950';

function ctaDeTarjeta(type: string | undefined): string {
  return TYPE_META[type ?? 'file']?.cta ?? 'Leer texto completo';
}

const EXTRA_CARD_CLASSES = `tarjeta-extras relative rounded-tr-xl rounded-bl-xl tarjeta p-4 text-xs! ring-1 ring-inset ring-stone-950/5 dark:ring-white/5 [overflow-wrap:anywhere] sm:p-5 sm:text-xs! md:text-sm! lg:p-6 lg:text-base! ${CARD_TEXT_CLASSES}`;

function extraCard(inner: string): string {
  return [`:::: {class="${EXTRA_CARD_CLASSES}"}`, '', inner, '', '::::'].join('\n');
}

interface LicenciaDef {
  iconos: readonly string[];
  parrafos: readonly string[];
}

const TEXTO_CC_BY_NC_ND = [
  'Algunos derechos reservados. Esta obra está bajo una Licencia Creative Commons Atribución-NoComercial-SinDerivadas 4.0 Internacional. Usted es libre de compartir, copiar y redistribuir el material en cualquier medio o formato, pero debe dar crédito de manera adecuada, brindar un enlace a la&nbsp;licencia e indicar si se han realizado cambios. No puede hacer uso de esta obra con propósitos comerciales, ni remezclar, transformar o crear obras derivadas, ni distribuir el material modificado.',
] as const;

const TEXTO_PF = [
  'Algunos derechos reservados. Esta obra está bajo una Licencia de Producción Feminista. Usted es libre de compartir, copiar, distribuir y adaptar esta obra en cualquier medio o formato, pero debe dar crédito a todas las personas que hicieron posible su creación, reconocer sus contribuciones e indicar si ha realizado cambios. Si remezcla, transforma o crea a partir de esta obra, debe distribuir la obra derivada bajo esta misma licencia; además, los materiales y archivos necesarios para su creación, modificación y reproducción deben ser de acceso público, de modo que cualquiera pueda consultar, modificar y reutilizar la obra derivada. La explotación comercial solo está permitida a cooperativas, organizaciones, colectivas y redes autogestivas que se identifiquen y organicen bajo principios feministas, anticapitalistas, antirracistas y decoloniales.',
] as const;

const LICENCIAS: Record<string, LicenciaDef> = {
  'CC-BY-NC-ND-4.0': { iconos: ['cc', 'by', 'nc', 'nd'], parrafos: TEXTO_CC_BY_NC_ND },
  'PF-AC-PR-FA-1.0': {
    iconos: ['pf', 'ac', 'pr', 'fa'],
    parrafos: TEXTO_PF,
  },
};

const LICENCIA_POR_DEFECTO = 'CC-BY-NC-ND-4.0';
const LICENSE_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/license');

function normalizarLicencia(valor: string | undefined): string | undefined {
  const limpio = valor?.trim().toLocaleUpperCase('es');
  return limpio === undefined || limpio === '' ? undefined : limpio;
}

function licenciaOverride(fm: Record<string, unknown>): string | false | undefined {
  const raw = fm.license;
  if (raw === false) return false;
  return typeof raw === 'string' ? raw : undefined;
}

function licenciaExplicita(override: string | false | undefined, siteConfig: SiteConfig): string | false | undefined {
  for (const valor of [override, siteConfig.format?.html?.site?.license, siteConfig.license]) {
    if (valor === false) return false;
    if (typeof valor === 'string' && valor.trim() !== '') return valor;
  }
  return undefined;
}

interface LicenciaResuelta {
  id: string;
  def: LicenciaDef;
}

function licenciaResuelta(siteConfig: SiteConfig, override?: string | false): LicenciaResuelta | undefined {
  const explicita = licenciaExplicita(override, siteConfig);
  if (explicita === false) return undefined;
  const id = normalizarLicencia(explicita) ?? LICENCIA_POR_DEFECTO;
  const def = LICENCIAS[id];
  return def === undefined ? undefined : { id, def };
}

export function licenciaEfectiva(fm: Record<string, unknown>, siteConfig: SiteConfig): string | undefined {
  return licenciaResuelta(siteConfig, licenciaOverride(fm))?.id;
}

export function iconosDeLicencias(ids: Iterable<string>): Set<string> {
  const iconos = new Set<string>();
  for (const id of ids) {
    for (const icono of LICENCIAS[id]?.iconos ?? []) iconos.add(icono);
  }
  return iconos;
}

function licenciaTexto(def: LicenciaDef): string {
  return def.parrafos.join('\n\n');
}

function licenciaMarkdown(def: LicenciaDef): string {
  return `## Licencia\n\n${licenciaTexto(def).replace(/&nbsp;/g, ' ')}`;
}

export function licenciaMarkdownPara(fm: Record<string, unknown>, siteConfig: SiteConfig): string | undefined {
  const licencia = licenciaResuelta(siteConfig, licenciaOverride(fm));
  return licencia === undefined ? undefined : licenciaMarkdown(licencia.def);
}

export function licenciaFrontmatterPara(fm: Record<string, unknown>, siteConfig: SiteConfig): { license: string; rights: string } | undefined {
  const licencia = licenciaResuelta(siteConfig, licenciaOverride(fm));
  return licencia === undefined ? undefined : { license: licencia.id, rights: licenciaTexto(licencia.def) };
}

function conLicenciaAlFinal(base: string, fm: Record<string, unknown>, siteConfig: SiteConfig): string {
  const licencia = licenciaMarkdownPara(fm, siteConfig);
  if (licencia === undefined || base.includes('## Licencia')) return base;
  return `${base}\n\n${licencia}`;
}

function licenciaLowertitleback(def: LicenciaDef, docDir: string): string {
  const iconos = def.iconos
    .map((nombre) => {
      const iconPath = relative(docDir, join(LICENSE_RESOURCES_DIR, `${nombre}.svg`));
      return `![](${posix(iconPath)}){width=15pt}`;
    })
    .join(' ');
  return ['::: {line-height=1}', iconos, '', ':::: {.text-xs}', licenciaTexto(def), '::::', ':::'].join('\n');
}

export function licenciaLowertitlebackPorDefecto(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  siteConfig: SiteConfig,
  docDir: string,
  docType?: string,
): string | undefined {
  if (docType === 'intervention') return undefined;
  if (fm.lowertitleback !== undefined || formatCfg?.lowertitleback !== undefined || siteConfig.lowertitleback !== undefined) return undefined;
  const uppertitleback = resolveStringField(fm, formatCfg, siteConfig, 'uppertitleback');
  if (uppertitleback === undefined || uppertitleback.trim() === '') return undefined;
  const licencia = licenciaResuelta(siteConfig, licenciaOverride(fm));
  return licencia === undefined ? undefined : licenciaLowertitleback(licencia.def, docDir);
}

function licenciaHtml(siteConfig: SiteConfig, dir: string, override?: string | false): string | undefined {
  const licencia = licenciaResuelta(siteConfig, override);
  if (licencia === undefined) return undefined;
  const iconos = licencia.def.iconos
    .map(
      (nombre) => `<img src="${relativeHref(dir, `${ASSETS_IMAGES_DIR}/${nombre}.webp`)}" alt="" class="block my-0!" style="width:32px;height:32px">`,
    )
    .join('');
  const parrafos = licencia.def.parrafos.map((parrafo) => `<p class="m-0">${parrafo}</p>`).join('');
  return [
    `<div class="mb-6 flex flex-wrap items-center gap-2"><h2 class="${EXTRA_PILL_CLASSES}">Licencia</h2></div>`,
    `<div class="mb-3 flex items-center gap-2">${iconos}</div>`,
    `<div class="contenido-compacto space-y-3">${parrafos}</div>`,
  ].join('');
}

export function creatorCard(
  doc: CreatorDoc,
  dir: string,
  creatorHrefs: Map<string, string>,
  available?: Set<string>,
  imagenes?: Map<string, string>,
): string {
  const retrato = doc.image === undefined ? undefined : imagenes?.get(doc.image);
  const perfil = creatorHrefs.get(doc.name);
  return extraCard(
    [
      chipHtml('Colaboradora', 'creator', dir, EXTRA_PILL_SPACED_CLASSES, available),
      '',
      ...(retrato === undefined ? [] : [retratoDeCreadora(retrato, doc.name, perfil), '']),
      `<h2 class="not-prose mb-4 text-center text-base tracking-wide sm:text-lg">${nombreEnlazadoHtml(doc.name, creatorHrefs)}</h2>`,
      '',
      doc.body.trim(),
    ].join('\n'),
  );
}

export function containersCard(
  contenedores: { titulo: string; href: string; type: string | undefined }[],
  dir: string,
  available?: Set<string>,
): string {
  const chips: string[] = [];
  if (contenedores.some((c) => c.type === 'collection')) chips.push(chipHtml('Colecciones', 'collection', dir, EXTRA_PILL_CLASSES, available));
  if (contenedores.some((c) => c.type === 'list')) chips.push(chipHtml('Listas', 'list', dir, EXTRA_PILL_CLASSES, available));
  const items = contenedores.map((c) => `- [${c.titulo}](${c.href})`).join('\n');
  return extraCard([`<div class="flex flex-wrap items-center gap-2 mb-4">${chips.join('')}</div>`, '', items].join('\n'));
}

function keywordChipsCard(keywords: { titulo: string; href: string; count?: number }[], ownerChip: string, titleHref?: string): string {
  if (keywords.length === 0) return '';
  const chips = keywords
    .map((keyword) => {
      const badge = keyword.count === undefined ? '' : `<span class="${KEYWORD_BADGE_CLASSES}">${keyword.count}</span>`;
      return `<a href="${keyword.href}" class="${SIDEBAR_KEYWORD_CHIP_CLASSES}">${Bun.escapeHTML(keyword.titulo)}${badge}</a>`;
    })
    .join('');
  const titulo =
    titleHref === undefined
      ? `<h2 class="${EXTRA_PILL_CLASSES}">Palabras clave</h2>`
      : `<a href="${titleHref}" class="${EXTRA_PILL_CLASSES} hover:underline">Palabras clave</a>`;
  return `<div class="${EXTRA_CARD_CLASSES}"><div class="mb-6 flex flex-wrap items-center gap-2">${titulo}${ownerChip}</div><div class="flex flex-wrap gap-2">${chips}</div></div>`;
}

export function keywordsCard(keywords: { titulo: string; href: string; count?: number }[], ownerLabel: string, titleHref?: string): string {
  const ownerChip = `<span class="${EXTRA_PILL_OUTLINE_CLASSES}">${Bun.escapeHTML(ownerLabel)}</span>`;
  return keywordChipsCard(keywords, ownerChip, titleHref);
}

function siteKeywordsCard(
  discoveryIndex: Map<string, DiscoveryEntry>,
  dir: string,
  siteTitle: string,
  titleHref?: string,
  siteHref?: string,
): string {
  const keywords = keywordListsOf(discoveryIndex).map(({ slug, label }) => ({
    titulo: label,
    href: keywordHref(dir, slug),
    count: keywordMembers(discoveryIndex, slug).length,
  }));
  const ownerChip =
    siteHref === undefined
      ? `<span class="${CHIP_OUTLINE_CLASSES}">${Bun.escapeHTML(siteTitle)}</span>`
      : `<a href="${siteHref}" class="${CHIP_OUTLINE_CLASSES}">${Bun.escapeHTML(siteTitle)}</a>`;
  return keywordChipsCard(keywords, ownerChip, titleHref);
}

function keywordIndexAvailable(discoveryIndex: Map<string, DiscoveryEntry>): boolean {
  return keywordListsOf(discoveryIndex).length >= 2;
}

function keywordIndexHref(dir: string, discoveryIndex: Map<string, DiscoveryEntry>): string | undefined {
  return keywordIndexAvailable(discoveryIndex) ? relativeHref(dir, `${KEYWORD_INDEX_SLUG}.html`) : undefined;
}

function recentesCard(discoveryIndex: Map<string, DiscoveryEntry>, dir: string): string {
  const recientes = miembrosDeUnType(discoveryIndex, 'all')
    .filter((ruta) => {
      const entry = discoveryIndex.get(ruta);
      return entry !== undefined && tipoDe(entry) !== 'list';
    })
    .slice(0, RECENTES_LIMIT);
  if (recientes.length === 0) return '';
  const items = recientes
    .map((ruta) => {
      const entry = discoveryIndex.get(ruta);
      const html = htmlPathFor(ruta, entry?.slug);
      return `<li><a href="${relativeHref(dir, html)}" class="text-accent-700 no-underline underline-offset-4 hover:underline dark:text-accent-300">${Bun.escapeHTML(entry?.title ?? ruta)}</a></li>`;
    })
    .join('');
  return `<div class="${EXTRA_CARD_CLASSES}"><div class="mb-6 flex flex-wrap items-center gap-2"><h2 class="${EXTRA_PILL_CLASSES}">Recientes</h2></div><ul class="m-0 list-disc space-y-1 ps-5">${items}</ul></div>`;
}

interface EnlaceMenu {
  name: string;
  url: string;
}

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

function enlacesConInicio(links: EnlaceMenu[], siteTitle: string): EnlaceMenu[] {
  return [{ name: siteTitle, url: './index.html' }, ...links];
}

function enlacesListasPorDefecto(available: Set<string>, conKeywords: boolean): EnlaceMenu[] {
  const enlaces = DEFAULT_LISTS.filter((lista) => lista.slug !== 'index' && available.has(lista.slug)).map((lista) => ({
    name: lista.title,
    url: `./${lista.slug}.html`,
  }));
  return conKeywords ? [...enlaces, { name: 'Palabras clave', url: `./${KEYWORD_INDEX_SLUG}.html` }] : enlaces;
}

function menuDelSitio(links: EnlaceMenu[], siteTitle: string, dir: string): { header?: string; footer?: string } {
  if (links.length === 0) return {};
  const conInicio = enlacesConInicio(links, siteTitle);
  return { header: menuHeaderLink(conInicio, dir), footer: menuFooterContent(conInicio, dir) };
}

function esEnlaceExterno(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url);
}

function hrefDeMenu(url: string, dir: string): string {
  if (esEnlaceExterno(url) || /^(?:mailto|tel):/i.test(url) || url.startsWith('#')) return url;
  return relativeHref(dir, url.replace(/^\.?\//, ''));
}

function enlaceDeMenuChip(enlace: EnlaceMenu, dir: string): string {
  const attrs = esEnlaceExterno(enlace.url) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${Bun.escapeHTML(hrefDeMenu(enlace.url, dir))}" class="${MENU_LINK_CLASSES}"${attrs}>${Bun.escapeHTML(enlace.name)}</a>`;
}

function menuHeaderLink(links: EnlaceMenu[], dir: string): string | undefined {
  if (links.length === 0) return undefined;
  return `<a href="${relativeHref(dir, 'menu.html')}" class="${MENU_BUTTON_CLASSES}" aria-label="Menú"><img src="${relativeHref(dir, `${ASSETS_IMAGES_DIR}/menu.webp`)}" alt="" class="h-4 w-4"><span>Menú</span></a>`;
}

function menuFooterContent(links: EnlaceMenu[], dir: string): string | undefined {
  if (links.length === 0) return undefined;
  const boton = menuHeaderLink(links, dir);
  const enlaces = links
    .slice(0, 10)
    .map((enlace) => enlaceDeMenuChip(enlace, dir))
    .join('');
  return `${boton}${enlaces}`;
}

function tituloSidebarHtml(title: string, href: string | undefined): string {
  const clases = 'not-prose mt-4 mb-4 text-center text-base font-bold text-accent-900 sm:text-lg dark:text-accent-300';
  return href === undefined
    ? `<h3 class="${clases}">${title}</h3>`
    : `<h3 class="${clases}"><a href="${href}" class="${MEMBER_LINK_CLASSES}">${title}</a></h3>`;
}

function announcementCard(
  e: CollectionEntry,
  href: string | undefined,
  dir: string,
  available: Set<string> | undefined,
  imagenes: Map<string, string>,
): string {
  const title = e.title || TITULO_POR_DEFECTO;
  const imagen = imagenDeCabecera(e, 'announcement', imagenes, href);
  const body = extractFragment(e.body, 150);
  return extraCard(
    [
      chipHtml('Anuncio', 'announcement', dir, EXTRA_PILL_CLASSES, available),
      '',
      ...(imagen === undefined ? [] : [imagen, '']),
      tituloSidebarHtml(title, href),
      '',
      body,
      '',
      href === undefined ? '' : `<p class="not-prose mt-4 text-center"><a href="${href}" class="${CARD_CTA_CLASSES}">Leer anuncio →</a></p>`,
    ].join('\n'),
  );
}

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
      const rel = htmlPathFor(entry.file, destino.slug);
      return announcementCard(entry, relativeHref(args.dir, rel), args.dir, args.available, args.imagenes);
    })
    .filter((card) => card !== '')
    .join('\n\n');
  if (cards === '') return '';
  const extraArgs: string[] = [];
  extraArgs.push(...luaFilterArgs([...args.filters.semantic, ...args.filters.user, ...args.filters.flags, ...args.filters.html]));
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
    ...args.imagenes,
    ...(args.announcementImages === undefined ? [] : hrefsDeImagenes(args.announcementImages, args.outputDir, args.dir)),
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

async function readAnuncios(discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): Promise<CollectionEntry[]> {
  const rutas = [...discoveryIndex.entries()].filter(([, entry]) => entry.type === 'announcement').map(([ruta]) => ruta);
  if (rutas.length === 0) return [];
  const entries = await readCollectionEntries(rutas, 'anuncios.md', [cwd], true);
  return entries.sort((a, b) => fechaOrdenable(discoveryIndex.get(b.file)) - fechaOrdenable(discoveryIndex.get(a.file)));
}

function menuPageMarkdown(links: EnlaceMenu[], dir: string): string {
  return links
    .map((enlace) => {
      const attrs = esEnlaceExterno(enlace.url) ? '{target="_blank" rel="noopener noreferrer"}' : '';
      return `- [${enlace.name}](${hrefDeMenu(enlace.url, dir)})${attrs}`;
    })
    .join('\n');
}

export function creatorLinksCard(nombre: string, links: { name: string; url: string }[]): string {
  const items = links.map((l) => `- [${l.name}](<${l.url}>){target="_blank" rel="noopener noreferrer"}`).join('\n');
  return extraCard(
    [
      `<div class="mb-6 flex flex-wrap items-center gap-2"><h2 class="${EXTRA_PILL_CLASSES}">Redes</h2><span class="${CHIP_OUTLINE_CLASSES}">${Bun.escapeHTML(nombre)}</span></div>`,
      '',
      items,
    ].join('\n'),
  );
}

async function buildExtrasHtml(
  args: {
    tarjetas?: string;
    creatorDocs: CreatorDoc[];
    contenedores: { titulo: string; href: string; type: string | undefined }[];
    palabrasClave: { titulo: string; href: string }[];
    keywordOwner: string;
    redesCreador: { name: string; url: string }[];
    duenoRedes: string;
    creatorImage?: string;
    creatorAlt?: string;
    keywordPageHref?: string;
    creatorHrefs: Map<string, string>;
    available?: Set<string>;
    filters: ExportContext['filters'];
    imagePaths?: string;
    imagenes?: Map<string, string>;
    sourcePath: string;
    dir: string;
  },
  parte: 'main' | 'sidebar' | 'creator' = 'main',
): Promise<string> {
  const extraArgs = ['--shift-heading-level-by=4'];
  extraArgs.push(...luaFilterArgs([...args.filters.semantic, ...args.filters.user, ...args.filters.flags, ...args.filters.html]));
  const render = async (partes: string[]): Promise<string> => {
    if (partes.length === 0) return '';
    const html = await execPandoc({
      input: partes.join('\n\n'),
      sourcePath: args.sourcePath,
      from: MD_READER,
      to: 'html5',
      extraArgs,
      env: imagePathsEnv(args.imagePaths),
    });
    return minifyHtml(html);
  };

  if (parte === 'main' || parte === 'creator') {
    const retrato = args.creatorImage === undefined ? '' : creatorPortraitHtml(args.creatorImage, args.creatorAlt ?? '');
    if (args.tarjetas === undefined || args.tarjetas === '') return retrato;
    const tarjetasHtml = await render([args.tarjetas]);
    if (parte === 'creator') return `${retrato}${tarjetasHtml}`;
    return `<div class="grid gap-4 sm:gap-6 xl:grid-cols-2 xl:gap-6">${retrato}${tarjetasHtml}</div>`;
  }

  const partes: string[] = [];
  for (const doc of args.creatorDocs) {
    partes.push([CARD_WRAPPER, '', creatorCard(doc, args.dir, args.creatorHrefs, args.available, args.imagenes), '', '</div>'].join('\n'));
  }
  if (args.contenedores.some((c) => c.type === 'collection')) {
    partes.push([CARD_WRAPPER, '', containersCard(args.contenedores, args.dir, args.available), '', '</div>'].join('\n'));
  }
  if (args.palabrasClave.length > 0) {
    partes.push([CARD_WRAPPER, '', keywordsCard(args.palabrasClave, args.keywordOwner, args.keywordPageHref), '', '</div>'].join('\n'));
  }
  if (args.redesCreador.length > 0) {
    partes.push([CARD_WRAPPER, '', creatorLinksCard(args.duenoRedes, args.redesCreador), '', '</div>'].join('\n'));
  }
  return render(partes);
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

async function syncKeywordIndex(args: {
  cwd: string;
  outputDir: string;
  renderCtx: RenderContext;
  exportCtx: ExportContext;
  discoveryIndex: Map<string, DiscoveryEntry>;
  listas: { slug: string; label: string; miembros: string[] }[];
}): Promise<void> {
  const { outputDir, discoveryIndex } = args;
  const dueno = htmlOwner(discoveryIndex, '.', KEYWORD_INDEX_SLUG);
  if (dueno !== undefined) {
    if (keywordIndexAvailable(discoveryIndex)) {
      logWarning(
        `no se escribió la lista de palabras clave porque "${KEYWORD_INDEX_SLUG}.html" es el archivo de "${dueno}": renombra ese documento para que la lista exista`,
        'build',
      );
    }
    return;
  }
  if (!keywordIndexAvailable(discoveryIndex)) {
    await rm(join(outputDir, `${KEYWORD_INDEX_SLUG}.html`), { force: true }).catch(() => {});
    return;
  }
  await emitKeywordIndex(args);
}

function keywordIndexContent(listas: { slug: string; label: string }[]): string {
  return listas.map(({ slug, label }) => `- [${Bun.escapeHTML(label)}](${keywordHref('.', slug)})`).join('\n');
}

async function emitKeywordIndex(args: {
  cwd: string;
  outputDir: string;
  renderCtx: RenderContext;
  exportCtx: ExportContext;
  discoveryIndex: Map<string, DiscoveryEntry>;
  listas: { slug: string; label: string; miembros: string[] }[];
}): Promise<void> {
  const { cwd, outputDir, renderCtx, exportCtx, discoveryIndex, listas } = args;
  const { plan, formatCfg } = renderCtx;
  if (!plan.activeFormats.html) return;

  const hrefsCreadores = creatorHrefs(discoveryIndex, '.');
  const available = availableDefaultListSlugs(discoveryIndex);
  const siteTitle = formatCfg?.html?.site?.title ?? 'iteraciones';
  const menu = menuDelSitio(enlacesDelMenu(discoveryIndex), siteTitle, '.');
  const doc: BuildDocument = {
    filePath: join(cwd, `${KEYWORD_INDEX_SLUG}.md`),
    relativePath: `${KEYWORD_INDEX_SLUG}.md`,
    frontmatter: { title: 'Palabras clave', date: '', creator: [], type: 'file', files: listas.flatMap((lista) => lista.miembros) },
  };
  const outputs: DocumentOutputs = {
    slug: KEYWORD_INDEX_SLUG,
    outSlug: KEYWORD_INDEX_SLUG,
    dir: '.',
    fm: { title: 'Palabras clave', type: 'file' },
    content: '',
    outBase: (name: string): string => join(outputDir, name),
  };
  const imagePaths = await writeListImagePaths(cwd, KEYWORD_INDEX_SLUG, new Map());
  const { top: anunciosTop, bottom: anunciosBottom } = await anunciosDeLaPagina({
    discoveryIndex,
    cwd,
    dir: '.',
    available,
    creatorHrefs: hrefsCreadores,
    imagenes: new Map(),
    outputDir,
    announcementImages: renderCtx.announcementImages,
    filters: exportCtx.filters,
    imagePaths,
    sourcePath: doc.filePath,
  });
  await emitHtmlPage({
    doc: doc,
    outputs: outputs,
    renderCtx: renderCtx,
    exportCtx: exportCtx,
    discoveryIndex: discoveryIndex,
    imagePaths: imagePaths,
    paginas: [keywordIndexContent(listas)],
    creatorHrefs: hrefsCreadores,
    extras: '',
    sidebarExtras: '',
    docChipOverride: 'Lista',
    menuHeader: menu.header,
    menuFooterPlain: menu.footer,
    pageChips: '',
    announcementsTop: anunciosTop,
    announcementsBottom: anunciosBottom,
    docChipHrefOverride: '',
    contentChipOverride: 'Palabras clave',
  });
}

interface EmitListPageArgs {
  cwd: string;
  outputDir: string;
  renderCtx: RenderContext;
  exportCtx: ExportContext;
  discoveryIndex: Map<string, DiscoveryEntry>;
  relativePath: string;
  slug: string;
  dir: string;
  title: string;
  description: string;
  miembros: string[];
  entradas: CollectionEntry[];
  pageSize: number;
  hrefsCreadores: Map<string, string>;
  available: Set<string>;
  imageKey: string;
  imageMap: Map<string, string>;
  docChip: string;
  docChipHref?: string;
  warning: (dueno: string) => string;
}

async function emitListPage(args: EmitListPageArgs): Promise<void> {
  const {
    cwd,
    outputDir,
    renderCtx,
    exportCtx,
    discoveryIndex,
    relativePath,
    slug,
    dir,
    title,
    description,
    miembros,
    entradas,
    pageSize,
    hrefsCreadores,
    available,
    imageKey,
    imageMap,
    docChip,
    docChipHref,
    warning,
  } = args;
  const dueno = htmlOwner(discoveryIndex, dir, slug);
  if (dueno !== undefined) {
    logWarning(warning(dueno), 'build');
    return;
  }

  const memberHrefs = memberHtmlHrefs(relativePath, entradas, discoveryIndex);
  const paginas = collectionCardsPages(
    entradas,
    memberHrefs,
    description,
    pageSize,
    hrefsCreadores,
    dir,
    available,
    true,
    discoveryIndex,
    { path: relativePath, outSlug: slug, showDates: renderCtx.formatCfg?.html?.site?.showDates === true },
    hrefsDeImagenes(imageMap, outputDir, dir),
  );
  const doc: BuildDocument = {
    filePath: join(cwd, relativePath),
    relativePath,
    frontmatter: { title, date: '', creator: [], type: 'list', files: miembros },
  };
  const outputs: DocumentOutputs = {
    slug,
    outSlug: slug,
    dir,
    fm: { title, type: 'list' },
    content: '',
    outBase: (name: string): string => join(outputDir, dir === '.' ? '' : dir, name),
  };
  const imagePaths = await writeListImagePaths(cwd, imageKey, imageMap);
  const siteTitle = renderCtx.formatCfg?.html?.site?.title ?? 'iteraciones';
  const menu = menuDelSitio(enlacesDelMenu(discoveryIndex), siteTitle, dir);
  const { top: anunciosTop, bottom: anunciosBottom } = await anunciosDeLaPagina({
    discoveryIndex,
    cwd,
    dir,
    available,
    creatorHrefs: hrefsCreadores,
    imagenes: hrefsDeImagenes(imageMap, outputDir, dir),
    outputDir,
    announcementImages: renderCtx.announcementImages,
    filters: exportCtx.filters,
    imagePaths,
    sourcePath: doc.filePath,
  });
  await emitHtmlPage({
    doc,
    outputs,
    renderCtx,
    exportCtx,
    discoveryIndex,
    imagePaths,
    paginas,
    creatorHrefs: hrefsCreadores,
    menuHeader: menu.header,
    menuFooterPlain: menu.footer,
    docChipOverride: docChip,
    docChipHrefOverride: docChipHref,
    announcementsTop: anunciosTop,
    announcementsBottom: anunciosBottom,
  });
  await removeExtraHtmlPages(outputDir, dir, slug, paginas.length, discoveryIndex);
}

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
    await emitListPage({
      cwd,
      outputDir,
      renderCtx,
      exportCtx,
      discoveryIndex,
      relativePath: `${KEYWORDS_DIR}/${slug}.md`,
      slug,
      dir: KEYWORDS_DIR,
      title: label,
      description: `Contenidos con la palabra clave «${label}».`,
      miembros,
      entradas: propias,
      pageSize,
      hrefsCreadores,
      available,
      imageKey: `${KEYWORDS_DIR}-${slug}`,
      imageMap: procesadas.imageMap,
      docChip: 'Palabra clave',
      docChipHref: keywordIndexAvailable(discoveryIndex) ? relativeHref(KEYWORDS_DIR, `${KEYWORD_INDEX_SLUG}.html`) : '',
      warning: () => `no se escribió la lista de "${label}" porque "${KEYWORDS_DIR}/${slug}.html" es el archivo de ese documento`,
    });
  }

  await syncKeywordIndex({ cwd, outputDir, renderCtx, exportCtx, discoveryIndex, listas });
}

function creadoresDeArchivosDeColeccion(e: CollectionEntry, discoveryIndex: Map<string, DiscoveryEntry>): string[] {
  const coleccion = discoveryIndex.get(e.file);
  const nombres = new Set<string>();
  for (const miembro of coleccion?.files ?? []) {
    for (const nombre of discoveryIndex.get(miembro)?.creator ?? []) nombres.add(nombre);
  }
  return [...nombres].sort((a, b) => a.localeCompare(b, 'es'));
}

function renderNombres(lista: string[], tono: 'accent' | 'gris' | 'plano', creatorHrefs: Map<string, string>): string {
  return lista.map((n) => `<span class="whitespace-nowrap">${nombreEnlazadoHtml(n, creatorHrefs, tono)}</span>`).join(', ');
}

function partesDeColeccion(titleHtml: string): string[] {
  return [
    '<h2 class="not-prose text-center text-sm font-semibold text-accent-700 sm:text-base dark:text-accent-300">Varias colaboradoras</h2>',
    '',
    titleHtml,
  ];
}

function creadoresDeTarjeta(e: CollectionEntry, discoveryIndex?: Map<string, DiscoveryEntry>): { tono: 'accent' | 'gris'; nombres?: string[] } {
  const tipo = e.type ?? 'file';
  if (tipo === 'creator') return { tono: 'accent' };
  if (tipo === 'collection') return { tono: 'gris', nombres: discoveryIndex === undefined ? [] : creadoresDeArchivosDeColeccion(e, discoveryIndex) };
  return { tono: 'accent', nombres: e.creator };
}

function titleHtmlPara(title: string, href: string | undefined): string {
  if (href === undefined)
    return `<h3 class="not-prose mb-4 text-center text-lg font-bold text-accent-900 sm:text-[22px] lg:text-2xl dark:text-accent-300">${title}</h3>`;
  return `<h3 class="not-prose mb-4 text-center text-lg font-bold text-accent-900 sm:text-[22px] lg:text-2xl dark:text-accent-300"><a href="${href}" class="${MEMBER_LINK_CLASSES}">${title}</a></h3>`;
}

interface PageRef {
  path: string;
  outSlug?: string;
  showDates?: boolean;
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
    const titulo = Bun.escapeHTML(contenedor.title || ruta);
    if (ruta === pagePath) {
      chips.push(`<span class="${CHIP_OUTLINE_CLASSES}">${titulo}</span>`);
      continue;
    }
    const html = htmlPathFor(ruta, contenedor.slug);
    chips.push(`<a href="${relativeHref(dir, html)}" class="${CHIP_OUTLINE_CLASSES} ${CHIP_HOVER_CLASSES}">${titulo}</a>`);
  }
  return chips;
}

function palabrasClaveDeRutas(
  rutas: string[],
  dir: string,
  discoveryIndex: Map<string, DiscoveryEntry>,
): { titulo: string; href: string; count: number }[] {
  const porSlug = new Map<string, string>();
  for (const ruta of rutas) {
    for (const keyword of keywordsOf(discoveryIndex.get(ruta))) {
      const slug = keywordSlug(keyword);
      if (slug === undefined) continue;
      if (htmlOwner(discoveryIndex, KEYWORDS_DIR, slug) !== undefined) continue;
      const actual = porSlug.get(slug);
      if (actual === undefined || keyword.localeCompare(actual, 'es') < 0) porSlug.set(slug, keyword);
    }
  }
  return [...porSlug]
    .sort(([, a], [, b]) => a.localeCompare(b, 'es'))
    .map(([slug, label]) => ({ titulo: label, href: keywordHref(dir, slug), count: keywordMembers(discoveryIndex, slug).length }));
}

function palabrasClaveDe(relativePath: string, dir: string, discoveryIndex: Map<string, DiscoveryEntry>): { titulo: string; href: string }[] {
  return palabrasClaveDeRutas([relativePath], dir, discoveryIndex);
}

function chipsDePagina(
  contenedores: { titulo: string; href: string; type: string | undefined }[],
  palabrasClave: { titulo: string; href: string }[],
): string {
  const chips: string[] = [];
  for (const contenedor of contenedores) {
    if (contenedor.type !== 'collection') continue;
    chips.push(`<a href="${contenedor.href}" class="${PAGE_COLLECTION_CHIP_CLASSES}">${Bun.escapeHTML(contenedor.titulo)}</a>`);
  }
  for (const keyword of palabrasClave) {
    chips.push(`<a href="${keyword.href}" class="${PAGE_KEYWORD_CHIP_CLASSES}">${Bun.escapeHTML(keyword.titulo)}</a>`);
  }
  return chips.join('');
}

function chipsDeCabecera(
  e: CollectionEntry,
  dir: string,
  available?: Set<string>,
  discoveryIndex?: Map<string, DiscoveryEntry>,
  page?: PageRef,
  currentHref?: string,
): string {
  const typeLabel = memberTypeLabel(e.type);
  if (typeLabel === undefined) return '';
  const chips = [
    chipHtml(typeLabel, e.type, dir, `${PILL_BASE} mt-0 mb-0`, available, currentHref),
    ...chipsDePertenencia(e, dir, page?.path, discoveryIndex),
  ];
  return `<div class="flex items-start justify-between gap-4"><div class="flex flex-wrap items-center gap-2 mb-6">${chips.join('')}</div><span class="${MEMBER_BADGE_CLASSES}">${e.posicion}</span></div>`;
}

function imagenDeCabecera(e: CollectionEntry, tipo: string, imagenes: Map<string, string> | undefined, href: string | undefined): string | undefined {
  const src = tipo === 'creator' ? e.image : primeraImagenDelCuerpo(e.body);
  if (src === undefined) return undefined;
  const abs = isAbsolute(src) ? src : resolve(e.dirAbs ?? '.', src);
  const imagen = imagenes?.get(abs);
  if (imagen === undefined) return undefined;
  if (tipo === 'creator') return retratoDeCreadora(imagen, e.title || TITULO_POR_DEFECTO, href);

  return figuraDeTarjeta(imagen, href, e.title || TITULO_POR_DEFECTO);
}

interface CabeceraTarjeta {
  chips: string;
  cuerpo: string[];
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
): CabeceraTarjeta {
  const tipo = e.type ?? 'file';
  const chips = chipsDeCabecera(e, dir, available, discoveryIndex, page, currentHref);
  const imagen = imagenDeCabecera(e, tipo, imagenes, href);
  const cuerpo: string[] = [];
  if (imagen !== undefined) cuerpo.push(imagen, '');
  if (tipo === 'collection') {
    cuerpo.push(...partesDeColeccion(titleHtml));
    return { chips, cuerpo };
  }
  const { tono, nombres } = creadoresDeTarjeta(e, discoveryIndex);
  const creator = nombres === undefined ? '' : nombres.length > 0 ? renderNombres(nombres, tono, creatorHrefs) : AUTORA_POR_DEFECTO;
  if (creator !== '')
    cuerpo.push(`<h2 class="not-prose text-center text-sm font-semibold text-accent-700 sm:text-base dark:text-accent-300">${creator}</h2>`, '');
  cuerpo.push(titleHtml);
  if (e.subtitle) cuerpo.push('', `<h4 class="text-center text-lg italic tracking-wide mb-4">${e.subtitle}</h4>`);
  if (page?.showDates === true && e.date !== undefined) {
    const fecha = e.date;
    cuerpo.push(
      '',
      `<p class="not-prose mb-4 text-center text-xs font-mono text-stone-600 sm:text-sm dark:text-stone-400"><time datetime="${Bun.escapeHTML(fecha)}">${Bun.escapeHTML(formatHumanDate(fecha) ?? fecha)}</time></p>`,
    );
  }
  return { chips, cuerpo };
}

function parrafosPlanos(fragment: string): string[] {
  return fragment
    .split(/\n{2,}/)
    .map((parrafo) =>
      parrafo
        .replace(/^:::[^\n]*$/gm, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&lt;\/?[a-z][^&]*?&gt;/gi, ' ')
        .replace(/:{3,}/g, ' ')
        .replace(/\\[ \t]*(?=\n|$)/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/[*_`~]/g, '')
        .replace(/^#+\s*/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/^[-+*]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim(),
    )
    .filter((parrafo) => parrafo !== '');
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
  const fragment = extractFragment(e.body, CARD_PREVIEW_MAX_WORDS);
  const cabecera = cabeceraDeTarjeta(e, titleHtmlPara(title, href), creatorHrefs, dir, available, discoveryIndex, page, currentHref, imagenes, href);
  const card = [`:::: {class="${COLLECTION_CARD_CLASSES}"}`, ''];
  if (cabecera.chips !== '') card.push(cabecera.chips, '');
  const contenido = [...cabecera.cuerpo];
  const parrafos = fragment === '' ? [] : parrafosPlanos(fragment);
  if (parrafos.length > 0) {
    const estiloPreview =
      ' style="mask-image:linear-gradient(to bottom,black 70%,transparent);-webkit-mask-image:linear-gradient(to bottom,black 70%,transparent)"';
    const previewHtml = [
      `<div class="tarjeta-preview-wrap min-h-0 flex-1 overflow-hidden"${estiloPreview}>`,
      `<p class="tarjeta-preview">${parrafos.map((parrafo) => Bun.escapeHTML(parrafo).replace(/\n/g, '<br>')).join('<br><br>')}</p>`,
      '</div>',
    ].join('\n');
    contenido.push('', previewHtml);
  }
  card.push(...contenido);
  if (href !== undefined) {
    card.push('', `<p class="not-prose mt-auto pt-4 text-center"><a href="${href}" class="${CARD_CTA_CLASSES}">${ctaDeTarjeta(e.type)} →</a></p>`);
  }
  card.push('', '::::');
  return [CARD_WRAPPER, '', ...card, '', '</div>'].join('\n');
}

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

function buildCollectionSectionsMarkdown(entries: CollectionEntry[], merge: boolean): string {
  return buildCollectionSections(merge ? printableEntries(entries) : entries, MARKDOWN_HEADINGS, merge ? 4 : 0);
}

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

  const alineacion = esFile ? '\\centering' : '\\raggedright';
  const subsubsectionStyle = `\\RedeclareSectionCommand[beforeskip=2\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}\n\\setkomafont{subsubsection}{${alineacion}\\normalsize\\normalfont\\scshape}`;
  const subsubsectionReset =
    '\\RedeclareSectionCommand[beforeskip=\\baselineskip,afterskip=\\baselineskip,afterindent=false]{subsubsection}\n\\setkomafont{subsubsection}{\\normalsize\\normalfont\\bfseries}';

  const nivel = esFile ? 'section' : 'part';
  const md: string[] = [];

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
  extraArgs.push(...luaFilterArgs([...filters.semantic, ...filters.latex]));
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

export function nombresDeAutora(doc: BuildDocument, fm: Record<string, unknown>): string[] {
  return [...doc.frontmatter.creator, ...parseAuthors(fm.contributor)];
}

function contenedoresDe(
  doc: BuildDocument,
  dir: string,
  discoveryIndex: Map<string, DiscoveryEntry>,
): { titulo: string; href: string; type: string | undefined }[] {
  const entry = discoveryIndex.get(doc.relativePath);
  const rutas = entry?.containedBy ?? [];
  return rutas.map((ruta) => {
    const contenedor = discoveryIndex.get(ruta);
    const html = htmlPathFor(ruta, contenedor?.slug);
    return { titulo: contenedor?.title || ruta, href: relativeHref(dir, html), type: contenedor?.type };
  });
}

function fechaDeContenido(entry: DiscoveryEntry | undefined): number {
  if (entry?.date !== undefined) {
    const fecha = Date.parse(entry.date);
    if (!Number.isNaN(fecha)) return fecha;
  }
  return Number.NEGATIVE_INFINITY;
}

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
  const lowertitlebackLicencia =
    active.latex || active.pdf
      ? licenciaLowertitlebackPorDefecto(outputs.fm, formatCfg?.pdf, ctx.siteConfig, dirname(doc.filePath), doc.frontmatter.type)
      : undefined;
  const fmConLicencia = lowertitlebackLicencia === undefined ? fmBase : { ...fmBase, lowertitleback: lowertitlebackLicencia };

  const membreteColeccion = collectionLetterheadFiles(collectionEntries);
  const alturaMembrete = collectionEntries
    .filter((e) => e.type === 'intervention')
    .reduce((max, e) => Math.max(max, parseLetterheadHeight(e.letterheadHeight)), LETTERHEAD_HEIGHT_MM);
  return preprocessDocumentImages({
    content: [
      collectionScanContent(collectionEntries, content),

      ...creatorDocs.flatMap((c) => (c.image === undefined ? [c.body] : [`![](${c.image})`, c.body])),
    ].join('\n\n'),
    fm: membreteColeccion.length > 0 ? { ...fmConLicencia, letterhead: membreteColeccion, letterheadHeight: `${alturaMembrete}mm` } : fmConLicencia,
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

    extraImages: [
      ...(collectionEntries.length > 0 || extraEntries.length > 0 ? imagenesDeLasTarjetas([...collectionEntries, ...extraEntries], ctx.cwd) : []),
      ...(doc.frontmatter.type === 'creator' ? retratoDeLaPagina(outputs.fm, dirname(doc.filePath)) : []),
    ],
  });
}

function paginasDeLaPagina(args: Parameters<typeof paginasDeDocumento>[0]): { paginas: string[]; tarjetasPaginas: string[] } {
  if (args.doc.frontmatter.type !== 'creator') return { paginas: paginasDeDocumento(args), tarjetasPaginas: [] };
  if (args.entradas.length === 0) return { paginas: [args.pageContent], tarjetasPaginas: [] };
  const tarjetasPaginas = collectionCardsPages(
    args.entradas,
    args.memberHrefs,
    '',
    args.pageSize,
    args.creatorHrefs,
    args.dir,
    args.available,
    false,
    args.discoveryIndex,
    { path: args.doc.relativePath, outSlug: args.outSlug, showDates: args.showDates },
    args.imagenes,
  );
  return { paginas: [args.pageContent, ...tarjetasPaginas.slice(1).map(() => '')], tarjetasPaginas };
}

async function extrasDeLaPagina(
  comunes: Omit<Parameters<typeof buildExtrasHtml>[0], 'tarjetas'>,
  tarjetasPaginas: string[],
  parte: 'main' | 'sidebar' | 'creator' = 'main',
): Promise<string | string[]> {
  if (parte === 'sidebar') return buildExtrasHtml({ ...comunes, tarjetas: '' }, 'sidebar');
  if (parte === 'creator') {
    if (tarjetasPaginas.length === 0) return buildExtrasHtml({ ...comunes, tarjetas: '' }, 'creator');
    return Promise.all(tarjetasPaginas.map((tarjetas) => buildExtrasHtml({ ...comunes, tarjetas }, 'creator')));
  }
  if (tarjetasPaginas.length === 0) return buildExtrasHtml({ ...comunes, tarjetas: '' }, 'main');
  return Promise.all(tarjetasPaginas.map((tarjetas) => buildExtrasHtml({ ...comunes, tarjetas }, 'main')));
}

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
  showDates: boolean;
}): string[] {
  if (args.entradas.length === 0) return [args.pageContent];
  return collectionCardsPages(
    args.entradas,
    args.memberHrefs,
    args.pageContent,
    args.pageSize,
    args.creatorHrefs,
    args.dir,
    args.available,
    false,
    args.discoveryIndex,
    { path: args.doc.relativePath, outSlug: args.outSlug, showDates: args.showDates },
    args.imagenes,
  );
}

function parteDeExtras(type: string | undefined): 'creator' | 'main' {
  return type === 'creator' ? 'creator' : 'main';
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
  const showDates = mergedFm.showDates === false ? false : mergedFm.showDates === true ? true : formatCfg?.html?.site?.showDates === true;
  const available = availableDefaultListSlugs(discoveryIndex);
  const esMenu = doc.frontmatter.type === 'menu';
  const siteTitle = formatCfg?.html?.site?.title ?? 'iteraciones';
  const enlaces = enlacesDelMenu(discoveryIndex);
  const menu = menuDelSitio(enlaces, siteTitle, outputs.dir);
  const menuHeader = esMenu ? undefined : menu.header;
  const menuFooterPlain = menu.footer;
  const enlacesMenuPage = [...enlacesConInicio(enlaces, siteTitle), ...enlacesListasPorDefecto(available, keywordIndexAvailable(discoveryIndex))];
  const pageContent = esMenu
    ? [splitFrontmatter(content).body.trim(), menuPageMarkdown(enlacesMenuPage, outputs.dir)].filter((parte) => parte !== '').join('\n\n')
    : content;
  const imagenes = hrefsDeImagenes(webMap, ctx.outputDir, outputs.dir);
  const esCreadora = doc.frontmatter.type === 'creator';
  const { paginas, tarjetasPaginas } = paginasDeLaPagina({
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
    imagenes,
    showDates,
  });
  assertPaginasLibres(doc.relativePath, outputs.dir, outputs.outSlug, paginas.length, discoveryIndex);

  const imagePaths = await writeImagePaths(doc, ctx.cwd, 'html', webMap, docDir, true);
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
  const esColeccion = doc.frontmatter.type === 'collection';
  const palabrasClave = esTexto
    ? palabrasClaveDe(doc.relativePath, outputs.dir, discoveryIndex)
    : esColeccion
      ? palabrasClaveDeRutas(
          collectionEntries.map((entrada) => entrada.file),
          outputs.dir,
          discoveryIndex,
        )
      : [];
  const keywordOwner = docChipLabel(doc.frontmatter.type);
  const duenoRedes = String(outputs.fm.name ?? outputs.fm.title ?? '');
  const creatorImage = retratoDePaginaHref(outputs.fm, webMap, docDir, ctx.outputDir, outputs.dir);
  const extrasComunes = {
    creatorDocs,
    contenedores: contenedoresDe(doc, outputs.dir, discoveryIndex),
    palabrasClave,
    keywordOwner,
    redesCreador: esCreadora ? creatorLinks : [],
    duenoRedes,
    creatorImage,
    creatorAlt: creatorImage === undefined ? undefined : `Retrato de ${doc.frontmatter.title || outputs.slug}`,
    keywordPageHref: keywordIndexHref(outputs.dir, discoveryIndex),
    creatorHrefs: hrefsCreadores,
    filters: exportCtx.filters,
    imagePaths,
    imagenes,
    sourcePath: doc.filePath,
    dir: outputs.dir,
    available,
  };
  const extras = await extrasDeLaPagina(extrasComunes, tarjetasPaginas, parteDeExtras(doc.frontmatter.type));
  const sidebarExtras = (await extrasDeLaPagina(extrasComunes, [], 'sidebar')) as string;
  const pageChips = chipsDePagina(extrasComunes.contenedores, extrasComunes.palabrasClave);

  const contenidos = paginas;
  const covers = htmlCoverUrls(mergedFm, docDir, webMap);
  const indices = indicesDeColeccion(doc, outputs, collectionEntries, memberHrefs, pageSize, ctx.siteConfig);

  await emitHtmlPage({
    doc: doc,
    outputs: outputs,
    renderCtx: renderCtx,
    exportCtx: exportCtx,
    discoveryIndex: discoveryIndex,
    imagePaths: imagePaths,
    paginas: contenidos,
    creatorHrefs: hrefsCreadores,
    extras: extras,
    sidebarExtras: sidebarExtras,
    covers: covers,
    indices: indices,
    creatorImage: creatorImage,
    menuHeader: menuHeader,
    menuFooterPlain: menuFooterPlain,
    pageChips: pageChips,
    announcementsTop: anunciosTop,
    announcementsBottom: anunciosBottom,
  });
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
    const baseConLicencia = conLicenciaAlFinal(base, outputs.fm, ctx.siteConfig);
    const imagePaths = await writeImagePaths(doc, ctx.cwd, 'epub', epubMap, docDir, false);
    const epubCover = epubCoverPath(mergedFm, docDir, epubMap);
    await convertToEpub(
      prependLinksMarkdown(baseConLicencia, creatorLinks),
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
  assets: { relImageMap: Map<string, string>; docDir: string; fmAssets: Record<string, unknown> },
  discoveryIndex: Map<string, DiscoveryEntry>,
): Promise<void> {
  const { ctx, plan, formatCfg } = renderCtx;
  if (!plan.activeFormats.markdown || !formatWorkSets.mdPaths.has(doc.relativePath)) return;
  if (!docProducesFormat(doc.frontmatter.type, 'markdown')) return;

  const { relImageMap, docDir, fmAssets } = assets;
  const licenciaFm = licenciaFrontmatterPara(outputs.fm, ctx.siteConfig);
  const fmConLicencia = licenciaFm === undefined ? fmAssets : { ...fmAssets, ...licenciaFm };
  const outPath = outputs.outBase(`${outputs.outSlug}${primaryOutputExtension('markdown')}`);
  const isCollection = doc.frontmatter.type === 'collection';
  const rootFiles = isCollection ? (doc.frontmatter.files ?? []) : undefined;
  const autoras = isCollection ? await resolveCollectionCreatorDocs(doc, discoveryIndex, ctx.cwd, outputs.fm) : [];

  await writeDistMarkdown({
    label: doc.relativePath,
    content: outputs.content,
    outPath,
    outputDir: ctx.outputDir,
    fm: fmConLicencia,
    exportDoc,
    relImageMap,
    docDir,
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
      if (miembrosDeUnType(discoveryIndex, lista.type).length > 1) slugs.add(lista.slug);
    }
  }
  return slugs;
}

function tipoDe(entry: DiscoveryEntry): string {
  return entry.type ?? (entry.files && entry.files.length > 0 ? 'collection' : 'file');
}

function placementDe(entry: CollectionEntry, discoveryIndex: Map<string, DiscoveryEntry>): 'top' | 'bottom' {
  return discoveryIndex.get(entry.file)?.fm?.placement === 'bottom' ? 'bottom' : 'top';
}

function miembrosDeUnType(discoveryIndex: Map<string, DiscoveryEntry>, type: string): string[] {
  const rutas = [...discoveryIndex.entries()]
    .filter(([, entry]) => (type === 'all' ? tipoDe(entry) !== 'menu' && tipoDe(entry) !== 'announcement' : tipoDe(entry) === type))
    .map(([ruta]) => ruta);

  if (type === 'creator') {
    const nombre = (ruta: string): string => discoveryIndex.get(ruta)?.title ?? ruta;
    return rutas.sort((a, b) => nombre(a).localeCompare(nombre(b), 'es') || a.localeCompare(b));
  }
  return rutas.sort((a, b) => {
    const diferencia = fechaOrdenable(discoveryIndex.get(b)) - fechaOrdenable(discoveryIndex.get(a));
    return diferencia !== 0 ? diferencia : a.localeCompare(b);
  });
}

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
    const fragmento = extractFragment(entrada.body, CARD_PREVIEW_MAX_WORDS);
    if (fragmento !== '') imagenes.push(...scanInlineImages(fragmento, dir));

    const src = primeraImagenDelCuerpo(entrada.body);
    if (src !== undefined) imagenes.push(isAbsolute(src) ? src : resolve(dir, src));
    if (entrada.type === 'creator' && entrada.image !== undefined) {
      imagenes.push(isAbsolute(entrada.image) ? entrada.image : resolve(dir, entrada.image));
    }
  }
  return imagenes;
}

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
    if (type === 'all' ? miembros.length === 0 : miembros.length < 2) continue;
    await emitListPage({
      cwd,
      outputDir,
      renderCtx,
      exportCtx,
      discoveryIndex,
      relativePath: `${slug}.md`,
      slug,
      dir: '.',
      title,
      description: description ?? '',
      miembros,
      entradas,
      pageSize,
      hrefsCreadores,
      available,
      imageKey: slug,
      imageMap: procesadas.imageMap,
      docChip: 'Lista',
      warning: (dueno) =>
        `no se escribió la lista de ${type} porque "${slug}.html" es el archivo de "${dueno}": renombra ese documento (con "slug:" en su frontmatter) para que la lista exista`,
    });
  }
}

async function writeListImagePaths(cwd: string, slug: string, imageMap: Map<string, string>): Promise<string> {
  return writePathsFile(join(cwd, '.iteraciones', 'paths', `_lista-${slug}.html.json`), imageMap, cwd, true);
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
