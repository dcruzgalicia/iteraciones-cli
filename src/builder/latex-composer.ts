import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { fmStringList, trimmedStringValue } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { execPandoc, MD_READER } from '../lib/pandoc-runner.js';
import { parseAuthors } from './discover.js';
import type { LuaFilterGroup } from './filter-resolver.js';
import { MBOX_HELPERS_FILTER } from './filter-resolver.js';
import type { PageDimensions } from './image-processor.js';
import { processDocumentImages, rewriteImagePaths, scanInlineImages, scanTitlePageFieldImages } from './image-processor.js';
import { babelOptionsForLang, pageNumberCommandFor } from './latex-preamble.js';
import { creatorArgs, dateArg, publisherArg, titleArg } from './pandoc-metadata.js';
import type { BuildDocument } from './types.js';

function rawFrontmatterDate(fm: Record<string, unknown>): string | undefined {
  return typeof fm.date === 'string' && fm.date.trim() ? fm.date.trim() : undefined;
}

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

async function pdfDate(fm: Record<string, unknown>, siteConfig: SiteConfig, doc: BuildDocument): Promise<string | undefined> {
  const rawDate = rawFrontmatterDate(fm);
  if (siteConfig.format?.pdf?.showDate === true) {
    if (rawDate) return formatHumanDate(rawDate);
    return fileCreationDate(doc);
  }
  if (rawDate || fm.date !== undefined) return '';
  return undefined;
}

interface LatexComposerOptions {
  filters: LuaFilterGroup;
  bibFiles: string[];
  templatePath: string;
  fm: Record<string, unknown>;
  siteConfig: SiteConfig;
  biblatexAvailable?: boolean;
  warnedLangs: Set<string>;
  pageDimensions?: PageDimensions;
  cropActive?: boolean;
  pdfxActive?: boolean;
}

interface ImagePreprocessResult {
  imageMap: Map<string, string>;
  processedImages: string[];
  finalContent: string;
}

async function preprocessDocumentImages(
  content: string,
  doc: BuildDocument,
  fm: Record<string, unknown>,
  pageDimensions: PageDimensions,
  cropActive: boolean,
  pdfxActive: boolean,
): Promise<ImagePreprocessResult> {
  const docDir = dirname(doc.filePath);
  const outputDir = join(docDir, '.iteraciones', 'processed-images');
  const inlineImages = scanInlineImages(content, docDir);
  const multilineImages = await scanTitlePageFieldImages(fm, docDir, pageDimensions.w);
  const result = await processDocumentImages(inlineImages, fm, docDir, pageDimensions, cropActive, outputDir, multilineImages, pdfxActive);
  if (result.imageMap.size === 0) return { imageMap: result.imageMap, processedImages: result.processedFiles, finalContent: content };
  return { imageMap: result.imageMap, processedImages: result.processedFiles, finalContent: rewriteImagePaths(content, result.imageMap, docDir) };
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

async function pushCoverImageMetadata(
  extraArgs: string[],
  fm: Record<string, unknown>,
  doc: BuildDocument,
  imageMap: Map<string, string>,
): Promise<void> {
  for (const field of ['title-image', 'endpapers']) {
    const value = trimmedStringValue(fm[field]);
    if (value) await resolveAndPushImage(extraArgs, field, value, doc, imageMap);
  }

  const pubImageRaw = fm['publisher-image'];
  const pubImages: string[] = Array.isArray(pubImageRaw)
    ? pubImageRaw.filter((v): v is string => typeof v === 'string')
    : typeof pubImageRaw === 'string' && pubImageRaw.trim()
      ? [pubImageRaw]
      : [];
  for (const value of pubImages) {
    await resolveAndPushImage(extraArgs, 'publisher-image', value, doc, imageMap);
  }
}

export async function markdownToLatex(
  content: string,
  doc: BuildDocument,
  opts: LatexComposerOptions,
): Promise<{ tex: string; processedImages: string[] }> {
  const {
    filters,
    bibFiles,
    templatePath,
    fm,
    siteConfig,
    biblatexAvailable = true,
    warnedLangs,
    pageDimensions,
    cropActive = false,
    pdfxActive = false,
  } = opts;
  const title = typeof fm.title === 'string' && fm.title.trim() ? fm.title : 'Sin título';
  const creator = parseAuthors(fm.creator);

  let imageMap = new Map<string, string>();
  let processedImages: string[] = [];
  let finalContent = content;
  if (pageDimensions) {
    ({ imageMap, processedImages, finalContent } = await preprocessDocumentImages(content, doc, fm, pageDimensions, cropActive, pdfxActive));
  }

  const extraArgs = ['--template', templatePath, '--top-level-division', 'section', '--shift-heading-level-by=2'];
  extraArgs.push(`--metadata=babel-lang:${babelOptionsForLang(siteConfig.language, warnedLangs)}`);
  extraArgs.push(`--metadata=biblatex-available:${biblatexAvailable}`);
  const pageCommand = pageNumberCommandFor(siteConfig.format?.pdf?.pageNumber ?? 'header-right');
  if (pageCommand) {
    extraArgs.push(`--metadata=page-number-command:${pageCommand}`);
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
  extraArgs.push(titleArg(title));
  await pushCoverImageMetadata(extraArgs, fm, doc, imageMap);
  extraArgs.push(...creatorArgs(creator));
  const publishers = fmStringList(fm.publisher);
  if (publishers) extraArgs.push(...publisherArg(publishers));
  const date = await pdfDate(fm, siteConfig, doc);
  extraArgs.push(...dateArg(date));

  const tex = await execPandoc({
    input: finalContent,
    sourcePath: doc.filePath,
    from: MD_READER,
    to: 'latex',
    extraArgs,
    env: { ITERACIONES_MBOX_HELPERS: MBOX_HELPERS_FILTER },
  });

  return { tex, processedImages };
}

export function buildTexDistribution(processedImages: string[], outSlug: string): Map<string, string> {
  const map = new Map<string, string>();
  const taken = new Set<string>();
  for (const abs of processedImages) {
    const sep = abs.lastIndexOf('/');
    const base = sep >= 0 ? abs.slice(sep + 1) : abs;
    let name = `${outSlug}-${base}`;
    if (taken.has(name)) {
      const dot = base.lastIndexOf('.');
      name = dot > 0 ? `${outSlug}-${base.slice(0, dot)}-2${base.slice(dot)}` : `${outSlug}-${base}-2`;
      let n = 2;
      while (taken.has(name)) {
        n++;
        name = dot > 0 ? `${outSlug}-${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${outSlug}-${base}-${n}`;
      }
    }
    taken.add(name);
    map.set(abs, name);
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
