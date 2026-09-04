import { dirname, isAbsolute, join, resolve } from 'node:path';
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
import { processDocumentImages, rewriteImagePaths, scanInlineImages, scanTitlePageFieldImages } from './image-processor.js';
import { babelOptionsForLang, pageNumberCommandFor } from './latex-preamble.js';
import { creatorArgs, dateArg, publisherArg, titleArg } from './pandoc-metadata.js';
import type { BuildDocument } from './types.js';

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
  filters: LuaFilterGroup;
  bibFiles: string[];
  templatePath: string;
  fm: Record<string, unknown>;
  siteConfig: SiteConfig;
  formatCfg?: Record<string, unknown>;
  biblatexAvailable?: boolean;
  warnedLangs: Set<string>;
  pageDimensions?: PageDimensions;
  cropActive?: boolean;
  pdfxActive?: boolean;
  cwd?: string;
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

const COVER_IMAGE_FIELDS = ['titleImage', 'publisherImage', 'endpapers'] as const;

function toAbsoluteImagePaths(value: string | string[], cwd: string): string | string[] {
  if (Array.isArray(value)) return value.map((v) => (isAbsolute(v) ? v : resolve(cwd, v)));
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function mergeConfigImages(
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
  for (const field of ['titleImage', 'endpapers']) {
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

function buildTitlePageOverrides(
  fm: Record<string, unknown>,
  formatCfg: Record<string, unknown> | undefined,
  siteConfig: SiteConfig,
  doc: BuildDocument,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const field of TITLE_PAGE_FIELDS) {
    const resolved = resolveMetadataField(fm, formatCfg, siteConfig, field);
    if (resolved !== undefined) {
      const shouldInject = doc.frontmatter.type === 'collection' || fm[field] === undefined;
      if (shouldInject) {
        const joined = Array.isArray(resolved) ? resolved.join(', ') : resolved;
        if (joined) overrides[field] = joined;
      }
    }
  }
  return overrides;
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
  return `${yaml}\n${content}`;
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
    formatCfg,
    biblatexAvailable = true,
    warnedLangs,
    pageDimensions,
    cropActive = false,
    pdfxActive = false,
    cwd = '',
  } = opts;
  const effectiveFm = mergeConfigImages(fm, formatCfg, siteConfig, cwd);
  const title = resolveStringField(fm, formatCfg, siteConfig, 'title') ?? 'Sin título';
  const creator = parseAuthors(resolveMetadataField(fm, formatCfg, siteConfig, 'creator'));

  let imageMap = new Map<string, string>();
  let processedImages: string[] = [];
  let finalContent = content;
  if (pageDimensions) {
    ({ imageMap, processedImages, finalContent } = await preprocessDocumentImages(content, doc, effectiveFm, pageDimensions, cropActive, pdfxActive));
  }

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
  extraArgs.push(titleArg(title));
  await pushCoverImageMetadata(extraArgs, effectiveFm, doc, imageMap);
  extraArgs.push(...creatorArgs(creator));
  const publishers = fmStringList(resolveMetadataField(fm, formatCfg, siteConfig, 'publisher'));
  if (publishers) extraArgs.push(...publisherArg(publishers));
  const date = await pdfDate(fm, formatCfg, siteConfig, doc);
  extraArgs.push(...dateArg(date));

  const courtesyPage = resolveBooleanField(fm, formatCfg, siteConfig, 'courtesyPage') === true;
  if (courtesyPage) extraArgs.push('--metadata=courtesy-page:true');

  const titleOverrides = buildTitlePageOverrides(fm, formatCfg, siteConfig, doc);
  const pandocContent = prependFrontmatterYaml(finalContent, titleOverrides, imageMap, dirname(doc.filePath));

  const tex = await execPandoc({
    input: pandocContent,
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
