import { copyFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { fmStringList, resolveBooleanField, resolveMetadataField, resolveStringField, trimmedStringValue } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { execPandoc, MD_READER } from '../lib/pandoc-runner.js';
import { parseAuthors } from './discover.js';
import type { LuaFilterGroup } from './filter-resolver.js';
import { MBOX_HELPERS_FILTER } from './filter-resolver.js';
import type { PageDimensions } from './image-processor.js';
import {
  imageNamerFor,
  processDocumentImages,
  rewriteImagePaths,
  scanInlineImages,
  scanTitlePageFieldImages,
  uniqueName,
} from './image-processor.js';
import { babelOptionsForLang, pageNumberCommandFor } from './latex-preamble.js';
import { ASSETS_IMAGES_DIR } from './output-layout.js';
import { creatorArgs, publisherArg, titleArg } from './pandoc-metadata.js';
import type { BuildDocument } from './types.js';
import { injectXmpMetadataIntoLatex, type PdfXmpMetadata } from './xmpdata.js';

const TITLE_PAGE_FIELDS = [
  'subtitle',
  'extratitle',
  'frontispiece',
  'titlehead',
  'subject',
  'dedication',
  'uppertitleback',
  'lowertitleback',
  'colophon',
];

async function fileCreationDate(doc: BuildDocument): Promise<string | undefined> {
  try {
    const fileStat = await Bun.file(doc.filePath).stat();
    const birthMs = fileStat.birthtimeMs;
    const noBirthtime = !Number.isFinite(birthMs) || birthMs <= 0;
    const btime = noBirthtime ? fileStat.mtime : fileStat.birthtime;
    if (!btime) return undefined;
    const y = btime.getFullYear();
    const m = String(btime.getMonth() + 1).padStart(2, '0');
    const d = String(btime.getDate()).padStart(2, '0');
    if (noBirthtime) {
      logWarning(`"${doc.filePath}" sin fecha de creación (birthtime); se usó la fecha de modificación`, 'latex');
    }
    return formatHumanDate(`${y}-${m}-${d}`);
  } catch {
    return undefined;
  }
}

async function pdfDate(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  siteConfig: SiteConfig,
  doc: BuildDocument,
): Promise<string | undefined> {
  const resolvedDate = resolveStringField(fm, formatCfg, siteConfig, 'date');
  const datePresent = fm.date !== undefined || formatCfg?.date !== undefined || siteConfig.date !== undefined;
  if (resolveBooleanField(fm, formatCfg, siteConfig, 'showDate') === true) {
    if (resolvedDate) return formatHumanDate(resolvedDate);
    return fileCreationDate(doc);
  }
  if (resolvedDate || datePresent) return '';
  return undefined;
}

interface LatexComposerOptions {
  /** #2445: ruta de la entrada materializada para build.sh (.iteraciones/collections). */
  inputTarget?: string;
  filters: LuaFilterGroup;
  bibFiles: string[];
  templatePath: string;
  fm: Record<string, unknown>;
  siteConfig: SiteConfig;
  formatCfg?: Record<string, unknown>;
  biblatexAvailable?: boolean;
  warnedLangs: Set<string>;
  images?: ImagePreprocessResult;
  cwd?: string;
}

export interface ImagePreprocessResult {
  imageMap: Map<string, string>;
  processedImages: string[];
}

export async function preprocessDocumentImages(
  content: string,
  doc: BuildDocument,
  fm: Record<string, unknown>,
  pageDimensions: PageDimensions,
  cropActive: boolean,
  pdfxActive: boolean,
  outputDir: string,
  outSlug: string,
): Promise<ImagePreprocessResult> {
  const docDir = dirname(doc.filePath);
  const inlineImages = scanInlineImages(content, docDir);
  const multilineImages = await scanTitlePageFieldImages(fm, docDir, pageDimensions.w);
  const result = await processDocumentImages(
    inlineImages,
    fm,
    docDir,
    pageDimensions,
    cropActive,
    outputDir,
    imageNamerFor(outSlug),
    multilineImages,
    pdfxActive,
  );
  return { imageMap: result.imageMap, processedImages: result.processedFiles };
}

async function resolveAndPushImage(
  extraArgs: string[],
  field: string,
  value: string,
  doc: BuildDocument,
  imageMap: Map<string, string>,
): Promise<void> {
  const imagePath = isAbsolute(value) ? value : resolve(dirname(doc.filePath), value);
  if (!(await Bun.file(imagePath).exists())) {
    throw new BuildError(`${field} no encontrado: "${imagePath}" (resuelto desde "${value}")`);
  }
  extraArgs.push(`--metadata=${field}:${imageMap.get(imagePath) ?? imagePath}`);
}

const COVER_IMAGE_FIELDS = ['titleImage', 'publisherImage', 'startpaper'] as const;

function toAbsoluteImagePaths(value: string | string[], cwd: string): string | string[] {
  if (Array.isArray(value)) return value.map((v) => (isAbsolute(v) ? v : resolve(cwd, v)));
  return isAbsolute(value) ? value : resolve(cwd, value);
}

export function mergeConfigImages(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  siteConfig: SiteConfig,
  cwd: string,
): Record<string, unknown> {
  const merged = { ...fm };
  for (const field of COVER_IMAGE_FIELDS) {
    if (merged[field] !== undefined) continue;
    const configValue = formatCfg?.[field] ?? siteConfig[field];
    if (configValue === undefined) continue;
    merged[field] = toAbsoluteImagePaths(configValue as string | string[], cwd);
  }
  return merged;
}

async function pushCoverImageMetadata(
  extraArgs: string[],
  fm: Record<string, unknown>,
  doc: BuildDocument,
  imageMap: Map<string, string>,
): Promise<void> {
  for (const field of ['titleImage', 'startpaper']) {
    const value = trimmedStringValue(fm[field]);
    if (value) await resolveAndPushImage(extraArgs, field, value, doc, imageMap);
  }

  const pubImageRaw = fm.publisherImage;
  const pubImages: string[] = Array.isArray(pubImageRaw)
    ? pubImageRaw.filter((v): v is string => typeof v === 'string')
    : typeof pubImageRaw === 'string' && pubImageRaw.trim()
      ? [pubImageRaw]
      : [];
  for (const value of pubImages) {
    await resolveAndPushImage(extraArgs, 'publisherImage', value, doc, imageMap);
  }
}

function resolveTitlePageValue(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  siteConfig: SiteConfig,
  field: string,
  isCollection: boolean,
): string | undefined {
  const resolved = resolveMetadataField(fm, formatCfg, siteConfig, field);
  if (resolved === undefined) return undefined;
  if (!isCollection && fm[field] !== undefined) return undefined;
  const joined = Array.isArray(resolved) ? resolved.join(', ') : resolved;
  return joined || undefined;
}

function buildTitlePageOverrides(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  siteConfig: SiteConfig,
  doc: BuildDocument,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  const isCollection = doc.frontmatter.type === 'collection';
  for (const field of TITLE_PAGE_FIELDS) {
    const value = resolveTitlePageValue(fm, formatCfg, siteConfig, field, isCollection);
    if (value) overrides[field] = value;
  }
  if (isCollection) {
    const prefix = resolveStringField(fm, formatCfg, siteConfig, 'collectionCreatorPrefix');
    if (prefix) overrides.collectionCreatorPrefix = prefix;
    const raw = resolveMetadataField(fm, formatCfg, siteConfig, 'collectionCreator');
    const creators = parseAuthors(raw);
    if (creators.length > 0) overrides.collectionCreator = creators.join(', ');
  }
  return overrides;
}

function applyInterventionOverrides(
  fm: Record<string, unknown>,
  docType: string | undefined,
): { title: string; creator: string[]; subtitle: string; date: string; extraPages: number; intervention: boolean } | null {
  if (docType !== 'intervention') return null;
  const lineLength = typeof fm.lineLength === 'number' && fm.lineLength > 0 ? fm.lineLength : 0.5;
  const pages = typeof fm.pages === 'number' && fm.pages > 0 ? fm.pages : 1;
  const rule = `\\rule{${lineLength}\\textwidth}{0.4pt}`;
  return { title: rule, creator: [rule], subtitle: '', date: '', extraPages: pages, intervention: true };
}

function yamlScalar(value: string): string {
  if (!value.includes('\n')) {
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }
  const lines = value.split('\n');
  const body = lines.map((l) => `  ${l}`).join('\n');
  return `|\n${body}`;
}

function prependFrontmatterYaml(content: string, overrides: Record<string, string>, imageMap: Map<string, string>, docDir: string): string {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return content;
  const lines = ['---'];
  for (const key of keys) {
    const value = overrides[key];
    if (value === undefined) continue;
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---');
  let yaml = lines.join('\n');
  yaml = rewriteImagePaths(yaml, imageMap, docDir);
  const fmEnd = content.indexOf('\n---\n');
  if (fmEnd >= 0) {
    return `${content.slice(0, fmEnd + 5)}\n${yaml}${content.slice(fmEnd + 5)}`;
  }
  return `${yaml}\n${content}`;
}

function buildPandocArgs(
  templatePath: string,
  siteConfig: SiteConfig,
  warnedLangs: Set<string>,
  biblatexAvailable: boolean,
  filters: LuaFilterGroup,
  bibFiles: string[],
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  isIntervention: boolean,
): string[] {
  const extraArgs = ['--template', templatePath, '--top-level-division', 'section', '--shift-heading-level-by=2'];
  extraArgs.push(`--metadata=babel-lang:${babelOptionsForLang(siteConfig.language, warnedLangs)}`);
  extraArgs.push(`--metadata=biblatex-available:${biblatexAvailable}`);
  const pageNumber = resolveStringField(fm, formatCfg, siteConfig, 'pageNumber');
  const pageCommand = pageNumberCommandFor(pageNumber ?? 'header-right');
  if (pageCommand) {
    extraArgs.push(`--metadata=page-number-command:${pageCommand}`);
  } else if (pageNumber) {
    logWarning(`pageNumber "${pageNumber}" no es una posición válida; se usa header-right`, 'latex');
  }
  for (const filter of [...filters.semantic, ...filters.user, ...filters.flags, ...filters.latex]) {
    extraArgs.push('--lua-filter', filter);
  }
  if (bibFiles.length > 0) {
    extraArgs.push('--biblatex');
    for (const bib of bibFiles) {
      extraArgs.push('--bibliography', bib);
    }
  }
  if (!isIntervention) {
    const title = resolveStringField(fm, formatCfg, siteConfig, 'title') ?? 'Sin título';
    extraArgs.push(titleArg(title));
    const creator = parseAuthors(resolveMetadataField(fm, formatCfg, siteConfig, 'creator'));
    extraArgs.push(...creatorArgs(creator));
    const subtitle = resolveStringField(fm, formatCfg, siteConfig, 'subtitle');
    if (subtitle) extraArgs.push(`--metadata=subtitle:${subtitle}`);
  }
  const publishers = fmStringList(resolveMetadataField(fm, formatCfg, siteConfig, 'publisher'));
  if (publishers) extraArgs.push(...publisherArg(publishers));
  return extraArgs;
}

function buildInterventionTitleOverrides(interventionOverrides: {
  title: string;
  creator: string[];
  subtitle: string;
  date: string;
}): Record<string, string> {
  return {
    title: interventionOverrides.title,
    creator: interventionOverrides.creator.join(' \\and '),
    subtitle: interventionOverrides.subtitle,
    date: interventionOverrides.date,
  };
}

function buildNormalTitleOverrides(title: string, creator: string[], subtitle: string | undefined, date: string | undefined): Record<string, string> {
  const overrides: Record<string, string> = {};
  if (title) overrides.title = title;
  if (creator.length > 0) overrides.creator = creator.join(' \\and ');
  if (subtitle) overrides.subtitle = subtitle;
  if (date !== undefined) overrides.date = date;
  return overrides;
}

/**
 * #2445 — el contenido EXACTO que pandoc recibe por stdin para un .tex.
 * El build y `iteraciones merge --format latex` pasan por aquí, para que
 * `.iteraciones/collections/<slug>.latex.md` sea byte-idéntico al stdin.
 * (Lo que viaja por argv --template/--metadata no cambia el contenido.)
 */
export async function buildLatexPandocContent(
  content: string,
  doc: BuildDocument,
  opts: Pick<LatexComposerOptions, 'fm' | 'formatCfg' | 'siteConfig' | 'images'>,
): Promise<string> {
  const { fm, formatCfg, siteConfig, images } = opts;
  const imageMap = images?.imageMap ?? new Map<string, string>();
  const interventionOverrides = applyInterventionOverrides(fm, doc.frontmatter.type);
  const title = interventionOverrides?.title ?? resolveStringField(fm, formatCfg, siteConfig, 'title') ?? 'Sin título';
  const creator = interventionOverrides?.creator ?? parseAuthors(resolveMetadataField(fm, formatCfg, siteConfig, 'creator'));
  const subtitle = interventionOverrides?.subtitle ?? resolveStringField(fm, formatCfg, siteConfig, 'subtitle');
  const date = interventionOverrides?.date ?? (await pdfDate(fm, formatCfg, siteConfig, doc));
  const docDir = dirname(doc.filePath);

  const titleOverrides = buildTitlePageOverrides(fm, formatCfg, siteConfig, doc);
  const interventionTitleOverrides = interventionOverrides
    ? buildInterventionTitleOverrides(interventionOverrides)
    : buildNormalTitleOverrides(title, creator, subtitle, date);
  Object.assign(titleOverrides, interventionTitleOverrides);
  let pandocContent = prependFrontmatterYaml(rewriteImagePaths(content, imageMap, docDir), titleOverrides, imageMap, docDir);

  if (interventionOverrides && interventionOverrides.extraPages > 0) {
    pandocContent += `\n\n${'\\null\\newpage\n'.repeat(interventionOverrides.extraPages)}`;
  }
  return pandocContent;
}

export async function markdownToLatex(
  content: string,
  doc: BuildDocument,
  opts: LatexComposerOptions,
): Promise<{ tex: string; processedImages: string[] }> {
  const { filters, bibFiles, templatePath, fm, siteConfig, formatCfg, biblatexAvailable = true, warnedLangs, images, cwd = '' } = opts;
  const effectiveFm = mergeConfigImages(fm, formatCfg, siteConfig, cwd);
  const interventionOverrides = applyInterventionOverrides(fm, doc.frontmatter.type);

  const extraArgs = buildPandocArgs(
    templatePath,
    siteConfig,
    warnedLangs,
    biblatexAvailable,
    filters,
    bibFiles,
    fm,
    formatCfg,
    !!interventionOverrides,
  );
  await pushCoverImageMetadata(extraArgs, effectiveFm, doc, images?.imageMap ?? new Map<string, string>());

  const courtesyPage = resolveBooleanField(fm, formatCfg, siteConfig, 'courtesyPage') === true;
  if (courtesyPage) extraArgs.push('--metadata=courtesy-page:true');
  if (interventionOverrides?.intervention) extraArgs.push('--metadata=intervention:true');

  const tex = await execPandoc({
    input: await buildLatexPandocContent(content, doc, { fm, formatCfg, siteConfig, images }),
    sourcePath: doc.filePath,
    from: MD_READER,
    to: 'latex',
    extraArgs,
    env: { ITERACIONES_MBOX_HELPERS: MBOX_HELPERS_FILTER },
    inputTarget: opts.inputTarget,
  });

  return { tex, processedImages: images?.processedImages ?? [] };
}

/**
 * #2450 — rutas del .tex de dist hacia `assets/images/`. El nombre de la imagen
 * lo decide ya el preproceso (`<slug>-<base>.jpg`), así que la copia junto al
 * .tex que hacía este paso desaparece: html, markdown y .tex comparten el mismo
 * fichero. El dedupe es una red de seguridad por si dos rutas distintas
 * parieran el mismo nombre de copia en un nivel.
 */
export function buildTexDistribution(processedImages: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const taken = new Set<string>();
  for (const abs of processedImages) {
    map.set(abs, `${ASSETS_IMAGES_DIR}/${uniqueName(basename(abs), taken)}`);
  }
  return map;
}

export function rewriteTexForDist(tex: string, distribution: Map<string, string>): string {
  let result = tex;
  for (const [abs, name] of distribution) {
    result = result.split(abs).join(name);
  }
  return result;
}

/**
 * #2448 — ningún export con ruta absoluta: lo que el .tex de dist apunte bajo
 * la raíz del proyecto (el QR del caché, en concreto) se reescribe relativo al
 * propio .tex, así que la copia de dist/files lo resuelve igual. El .tex de
 * trabajo no es export y conserva la ruta absoluta que sí resuelve en la raíz.
 */
export function relativizeTexForDist(tex: string, texDir: string, projectRoot: string): string {
  const rel = relative(texDir, projectRoot).split(sep).join('/');
  if (rel === '') return tex;
  return tex.split(`${projectRoot}/`).join(`${rel}/`);
}

const IMAGE_EXTS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.pdf', '.png', '.svg', '.tif', '.tiff', '.webp']);

function isInside(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * #2450 — a dónde apunta el .tex de dist un fichero que vive bajo la raíz del
 * proyecto: una imagen se muda al `assets/images` del nivel (y hay que copiarla);
 * con `bundle: true`, la bibliografía apunta a la copia que bundle replica en la
 * raíz de la salida. `null` deja el fichero en manos de `relativizeTexForDist`.
 */
async function distAssetTarget(
  abs: string,
  texDir: string,
  projectRoot: string,
  distRoot: string,
  bundle: boolean,
): Promise<{ rel: string; copy: boolean } | null> {
  if (!(await Bun.file(abs).exists())) return null;
  const ext = extname(abs).toLowerCase();
  if (IMAGE_EXTS.has(ext)) {
    const rel = `${ASSETS_IMAGES_DIR}/${basename(abs)}`;
    return { rel, copy: resolve(texDir, rel) !== resolve(abs) };
  }
  if (ext !== '.bib' || !bundle || !isInside(projectRoot, abs)) return null;
  return {
    rel: relative(texDir, join(distRoot, relative(projectRoot, abs)))
      .split(sep)
      .join('/'),
    copy: false,
  };
}

/**
 * #2450 — el .tex de dist no apunta fuera de `dist/files`: las imágenes bajo la
 * raíz del proyecto (el QR que escribe el filtro, en concreto) se copian al
 * `assets/images` del nivel y se referencian ahí; con `bundle: true` la
 * bibliografía apunta a la copia que bundle replica en la raíz de la salida.
 * Lo que siga bajo la raíz sin resolver se relativa como antes (#2448). El .tex
 * de trabajo no pasa por aquí: conserva las rutas absolutas que sí resuelven.
 */
export async function localizeDistAssets(
  tex: string,
  opts: { texDir: string; projectRoot: string; distRoot: string; bundle: boolean },
): Promise<{ tex: string; copies: { src: string; rel: string }[] }> {
  const { texDir, projectRoot, distRoot, bundle } = opts;
  const prefix = `${projectRoot}/`;
  let result = tex;
  const copies = new Map<string, { src: string; rel: string }>();
  if (result.includes(prefix)) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tails = new Set([...result.matchAll(new RegExp(`${escaped}([^{}$\\n]+)`, 'g'))].map((m) => m[1] ?? ''));
    for (const tail of tails) {
      const abs = `${prefix}${tail}`;
      const target = await distAssetTarget(abs, texDir, projectRoot, distRoot, bundle);
      if (target === null) continue;
      if (target.copy) copies.set(abs, { src: abs, rel: target.rel });
      result = result.split(abs).join(target.rel);
    }
  }
  return { tex: relativizeTexForDist(result, texDir, projectRoot), copies: [...copies.values()] };
}

/**
 * #2445 — todo lo que el .tex de dist lleva y la salida cruda de pandoc no:
 * bloque de autores, metadatos XMP (PDF/X) y rutas de imagen acomodadas para
 * que el .tex de dist se mueva con su `assets/`. El build lo escribe como
 * manifiesto en `.iteraciones/post/<slug>.json` y `iteraciones post latex` lo repite.
 */
export interface LatexPostManifest {
  authorsBlock?: string;
  xmp?: PdfXmpMetadata;
  /** Ruta absoluta de la imagen procesada → relativa al nivel, dentro de `assets/images`. */
  distribution?: Record<string, string>;
  /** #2448: raíz del proyecto; el .tex de dist escribe sus rutas relativas a sí mismo. */
  projectRoot?: string;
  /** #2450: raíz de dist y si la réplica lleva la bibliografía (la bib apunta a esa copia). */
  distRoot?: string;
  bundle?: boolean;
}

/** #2450 — copia al nivel del .tex los ficheros que sus rutas relativas piden. */
export async function copyDistAssets(texDir: string, copies: { src: string; rel: string }[]): Promise<void> {
  for (const { src, rel } of copies) {
    const dest = join(texDir, rel);
    if (resolve(dest) === resolve(src) || !(await Bun.file(src).exists())) continue;
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
}

export function insertAuthorsBlock(tex: string, authorsBlock: string): string {
  if (!authorsBlock) return tex;
  if (tex.includes('\\printbibliography')) return tex.replace('\\printbibliography', `${authorsBlock}\n\n\\printbibliography`);
  if (tex.includes('\\colophon{')) return tex.replace('\\colophon{', `${authorsBlock}\n\n\\colophon{`);
  return tex;
}

export async function postProcessLatex(tex: string, manifest: LatexPostManifest, texDir?: string): Promise<string> {
  const withAuthors = insertAuthorsBlock(tex, manifest.authorsBlock ?? '');
  const withXmp = manifest.xmp === undefined ? withAuthors : injectXmpMetadataIntoLatex(withAuthors, manifest.xmp);
  const rewritten = manifest.distribution === undefined ? withXmp : rewriteTexForDist(withXmp, new Map(Object.entries(manifest.distribution)));
  if (manifest.projectRoot === undefined || texDir === undefined) return rewritten;
  // #2450: lo que quede bajo la raíz (el QR del caché) se muda al assets/images
  // del nivel y la bibliografía apunta a la copia que bundle puso en dist.
  const localized = await localizeDistAssets(rewritten, {
    texDir,
    projectRoot: manifest.projectRoot,
    distRoot: manifest.distRoot ?? manifest.projectRoot,
    bundle: manifest.bundle === true,
  });
  await copyDistAssets(texDir, localized.copies);
  return localized.tex;
}
