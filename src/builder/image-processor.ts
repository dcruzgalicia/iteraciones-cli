import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { BuildError } from '../lib/errors.js';
import { fmStringList } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { relativeAssetHref, relativePageHref } from '../lib/paths.js';
import { cpuConcurrency, exec, mapWithConcurrency, ProcessSpawnError, ProcessTimeoutError } from '../lib/run.js';
import { isScriptCapture, recordSupportCommand } from '../lib/script-recorder.js';
import { resetToolVersionCache, toolVersion } from '../lib/tool-version.js';
import { toMm } from './latex-preamble.js';
import { ASSETS_IMAGES_DIR } from './output-layout.js';

const MM_TO_PX_300DPI = 300 / 25.4;

const MAGICK_TIMEOUT_MS = 120_000;

export async function detectMagick(): Promise<boolean> {
  return (await toolVersion('magick')) !== '';
}

let warnedMissingMagick = false;

export function resetMagickCache(): void {
  resetToolVersionCache();
  warnedMissingMagick = false;
  resetImageCache();
}

export interface PageDimensions {
  w: number;
  h: number;
  textW: number;
}

function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX_300DPI);
}

export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let n = 2;
  let name = `${stem}-2${ext}`;
  while (taken.has(name)) {
    n++;
    name = `${stem}-${n}${ext}`;
  }
  taken.add(name);
  return name;
}

interface ImageProcessSpec {
  outPath: string;
  resize?: string;
  extent?: string;
  density300: boolean;
  grayscale: boolean;
  quality: number;
  alphaQuality?: number;
  targetDefine?: string;
  flatten: boolean;
}

function imageArgs(inputPath: string, spec: ImageProcessSpec, quality: number, isSvg: boolean): string[] {
  const args: string[] = [];
  if (isSvg) args.push('-density', '300', '-units', 'PixelsPerInch');
  args.push(inputPath);
  if (spec.resize !== undefined) args.push('-resize', spec.resize);
  if (spec.extent !== undefined) args.push('-gravity', 'center', '-extent', spec.extent);
  if (spec.density300) args.push('-density', '300', '-units', 'PixelsPerInch');
  if (spec.grayscale) args.push('-colorspace', 'Gray');
  if (spec.targetDefine !== undefined) args.push('-define', spec.targetDefine);
  if (spec.alphaQuality !== undefined) args.push('-define', `webp:alpha-quality=${spec.alphaQuality}`);
  args.push('-quality', String(quality));
  if (spec.flatten) args.push('-background', 'white', '-flatten');
  args.push(spec.outPath);
  return args;
}

export async function spawnMagick(args: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(['magick', ...args], { stdout: 'ignore', stderr: 'ignore' });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function runMagick(inputPath: string, args: string[]): Promise<boolean> {
  try {
    const result = await exec('magick', args, { timeoutMs: MAGICK_TIMEOUT_MS });
    if (result.exitCode === 0) return true;
    logWarning(`ImageMagick falló al procesar "${basename(inputPath)}": ${result.stderr.trim()}`, 'images');
  } catch (err) {
    if (err instanceof ProcessSpawnError) {
      logWarning(`ImageMagick no está disponible: se omite el preproceso de "${basename(inputPath)}"`, 'images');
      return false;
    }
    if (err instanceof ProcessTimeoutError) {
      logWarning(
        `ImageMagick no terminó en ${MAGICK_TIMEOUT_MS / 1000}s y fue terminado: se usa la imagen original "${basename(inputPath)}"`,
        'images',
      );
      return false;
    }
    throw err;
  }
  return false;
}

async function processImage(inputPath: string, spec: ImageProcessSpec): Promise<boolean> {
  await mkdir(dirname(spec.outPath), { recursive: true });
  const isSvg = inputPath.toLowerCase().endsWith('.svg');
  return runMagick(inputPath, imageArgs(inputPath, spec, spec.quality, isSvg));
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?/g;

const PX_TO_MM_96DPI = 25.4 / 96;

function parseWidthMm(attrs: string | undefined, pageWidthmm: number): number | undefined {
  if (!attrs) return undefined;
  const match = attrs.match(/width\s*=\s*([\d.]+)\s*(pt|mm|cm|px|%)/);
  if (!match) return undefined;
  const valueStr = match[1];
  const unit = match[2];
  if (!valueStr || !unit) return undefined;
  const value = Number.parseFloat(valueStr);
  if (unit === 'px') return value * PX_TO_MM_96DPI;
  if (unit === '%') return pageWidthmm * (value / 100);
  return toMm(value, unit);
}

function parseHeightMm(attrs: string | undefined): number | undefined {
  if (!attrs) return undefined;
  const match = attrs.match(/height\s*=\s*([\d.]+)\s*(pt|mm|cm|px|in)/);
  if (!match) return undefined;
  const valueStr = match[1];
  const unit = match[2];
  if (!valueStr || !unit) return undefined;
  const value = Number.parseFloat(valueStr);
  if (unit === 'px') return value * PX_TO_MM_96DPI;
  return toMm(value, unit);
}

export const COVER_IMAGE_FIELDS = ['titleImage', 'publisherImage', 'startpaper', 'frontCover', 'backCover'] as const;

export const LETTERHEAD_FIELD = 'letterhead';
export const LETTERHEAD_HEIGHT_MM = 50;

export function parseLetterheadHeight(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value * 10 : LETTERHEAD_HEIGHT_MM;
  if (typeof value !== 'string') return LETTERHEAD_HEIGHT_MM;
  const match = /^\s*([\d.]+)\s*(mm|cm|pt|in)?\s*$/i.exec(value);
  const numero = Number.parseFloat(match?.[1] ?? '');
  const unidad = (match?.[2] ?? 'cm').toLowerCase();
  if (!(numero > 0)) return LETTERHEAD_HEIGHT_MM;
  if (unidad === 'in') return numero * 25.4;
  return toMm(numero, unidad) ?? LETTERHEAD_HEIGHT_MM;
}
const IMAGE_FIELDS = [...COVER_IMAGE_FIELDS, LETTERHEAD_FIELD] as const;

const MULTILINE_IMAGE_FIELDS = [
  'lowertitleback',
  'uppertitleback',
  'dedication',
  'extratitle',
  'frontispiece',
  'titlehead',
  'collectionCreator',
  'colophon',
];

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

export interface InlineImageSource {
  absPath: string;
  widthMm?: number;
  heightMm?: number;
}

export function scanInlineImageSources(content: string, docDir: string, pageWidthmm = 215.9): InlineImageSource[] {
  const sources: InlineImageSource[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined, attrs?: string): void => {
    const imgPath = raw?.replace(/^<|>$/g, '');
    if (!imgPath || imgPath.startsWith('http') || imgPath.startsWith('data:')) return;
    const absPath = isAbsolute(imgPath) ? imgPath : resolve(docDir, imgPath);
    if (seen.has(absPath)) return;
    seen.add(absPath);
    sources.push({ absPath, widthMm: parseWidthMm(attrs, pageWidthmm), heightMm: parseHeightMm(attrs) });
  };
  for (const match of content.matchAll(MD_IMAGE_RE)) push(match[2], match[3]);

  for (const match of content.matchAll(/^\[[^\]]+\]:[ \t]+(\S+)/gm)) {
    if (IMAGE_EXT_RE.test(match[1] ?? '')) push(match[1]);
  }

  for (const match of content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) push(match[1]);
  return sources;
}

function fieldText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.join('\n');
  return undefined;
}

async function collectFieldImages(
  field: string,
  text: string,
  docDir: string,
  pageWidthmm: number,
  results: { absPath: string; isSvg: boolean; attrs?: string; widthMm?: number; field: string }[],
): Promise<void> {
  for (const match of text.matchAll(MD_IMAGE_RE)) {
    const imgPath = match[2];
    const attrs = match[3];
    if (!imgPath || isAbsolute(imgPath) || imgPath.startsWith('http')) continue;

    const abs = resolve(docDir, imgPath);
    const isSvg = imgPath.toLowerCase().endsWith('.svg');

    if (!(await Bun.file(abs).exists())) {
      throw new BuildError(`imagen no encontrada en "${field}": "${abs}" (resuelto desde "${imgPath}")`);
    }

    if (isSvg && !attrs?.includes('width')) {
      throw new BuildError(`imagen SVG en "${field}" requiere {width=...}: "${imgPath}"`);
    }

    results.push({ absPath: abs, isSvg, attrs, widthMm: parseWidthMm(attrs, pageWidthmm), field });
  }
}

export async function scanTitlePageFieldImages(
  fm: Record<string, unknown>,
  docDir: string,
  pageWidthmm = 215.9,
): Promise<{ absPath: string; isSvg: boolean; attrs?: string; widthMm?: number; field: string }[]> {
  const results: { absPath: string; isSvg: boolean; attrs?: string; widthMm?: number; field: string }[] = [];
  for (const field of MULTILINE_IMAGE_FIELDS) {
    const text = fieldText(fm[field]);
    if (text === undefined) continue;
    await collectFieldImages(field, text, docDir, pageWidthmm, results);
  }
  return results;
}

export function rewriteImagePaths(content: string, imageMap: Map<string, string>, docDir: string): string {
  if (imageMap.size === 0) return content;
  let result = content;
  for (const [absoluteOriginal, processed] of imageMap) {
    if (processed === absoluteOriginal) continue;
    const rel = relative(docDir, absoluteOriginal);
    const candidates = [rel, `./${rel}`, absoluteOriginal];
    for (const candidate of candidates) {
      if (candidate === '') continue;
      const escaped = RegExp.escape(candidate);
      result = result.replace(new RegExp(`\\]\\(${escaped}\\)`, 'g'), () => `](${processed})`);
      result = result.replace(
        new RegExp(`^((?:titleImage|publisherImage|startpaper|frontCover|backCover):[ \\t]*)(["']?)${escaped}(["']?[ \\t]*)$`, 'gm'),
        (_m, pre: string, openQuote: string, closeQuote: string) => `${pre}${openQuote}${processed}${closeQuote}`,
      );

      result = result.replace(
        new RegExp(`^([ \\t]*-[ \\t]+)?(["']?)${escaped}(["']?)[ \\t]*$`, 'm'),
        (_m, dash = '', openQuote = '', closeQuote = '') => `${dash}${openQuote}${processed}${closeQuote}`,
      );

      result = result.replace(
        new RegExp(`^(\\[[^\\]]+\\]:[ \\t]+)(["']?)${escaped}(["']?)[ \\t]*$`, 'gm'),
        (_m, pre: string, openQuote: string, closeQuote: string) => `${pre}${openQuote}${processed}${closeQuote}`,
      );

      result = result.replace(
        new RegExp(`(src=["']?)${escaped}(["'])`, 'gi'),
        (_m, pre: string, closeQuote: string) => `${pre}${processed}${closeQuote}`,
      );
    }
  }
  return result;
}

export function imagePathsMap(imageMap: Map<string, string>, docDir: string, relativize: boolean, fromDir = '.'): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const [absoluteOriginal, processed] of imageMap) {
    if (processed === absoluteOriginal) continue;
    const value = relativize ? relativeAssetHref(fromDir, `${ASSETS_IMAGES_DIR}/${basename(processed)}`) : processed;
    const rel = relative(docDir, absoluteOriginal);
    for (const key of [absoluteOriginal, rel, `./${rel}`]) {
      if (key !== '') paths[key] = value;
    }
  }
  return paths;
}

export function rewriteFmImagePaths(fm: Record<string, unknown>, imageMap: Map<string, string>, docDir: string): Record<string, unknown> {
  if (imageMap.size === 0) return fm;
  const out: Record<string, unknown> = { ...fm };
  for (const field of [...IMAGE_FIELDS, ...MULTILINE_IMAGE_FIELDS]) {
    const value = out[field];
    if (typeof value === 'string') out[field] = rewriteImagePaths(value, imageMap, docDir);
    else if (Array.isArray(value)) out[field] = value.map((v) => (typeof v === 'string' ? rewriteImagePaths(v, imageMap, docDir) : v));
  }
  return out;
}

interface ProcessTargets {
  targetW: number;
  targetH: number;
  startpaperW: number;
  startpaperH: number;
}

export function computeProcessTargets(pageDims: PageDimensions, cropActive: boolean): ProcessTargets {
  return {
    targetW: pageDims.textW + (cropActive ? 6 : 0),
    targetH: pageDims.h + (cropActive ? 6 : 0),
    startpaperW: pageDims.w + (cropActive ? 6 : 0),
    startpaperH: pageDims.h + (cropActive ? 6 : 0),
  };
}

export interface ImageSource {
  absPath: string;
  kind: 'cover' | 'title' | 'inline';
  cover: boolean;
  field?: string;
  widthMm?: number;
  heightMm?: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ProcessedImages {
  imageMap: Map<string, string>;
  processedFiles: string[];
  sizes: Map<string, ImageDimensions>;
  names: Map<string, string>;
}

export interface DocumentImages {
  pdf?: ProcessedImages;
  web?: ProcessedImages;
  epub?: ProcessedImages;
}

const FULL_PAGE_COVER_FIELDS = ['startpaper', 'frontCover', 'backCover'];

function warnMissingMagick(pdfxActive: boolean): void {
  if (!warnedMissingMagick) {
    warnedMissingMagick = true;
    logWarning(`ImageMagick no disponible; las imágenes no se preprocesaron${pdfxActive ? '; pueden fallar la certificación PDF/X' : ''}`, 'images');
  }
}

async function collectFieldSources(fm: Record<string, unknown>, docDir: string, push: (source: ImageSource) => void): Promise<void> {
  const alturaMembrete = parseLetterheadHeight(fm.letterheadHeight);
  for (const field of IMAGE_FIELDS) {
    const cover = FULL_PAGE_COVER_FIELDS.includes(field);
    const membrete = field === LETTERHEAD_FIELD;
    for (const value of fmStringList(fm[field]) ?? []) {
      const absPath = isAbsolute(value) ? value : resolve(docDir, value);
      if (!(await Bun.file(absPath).exists())) {
        if (FULL_PAGE_COVER_FIELDS.includes(field)) {
          logWarning(`portada declarada pero no encontrada en "${field}": "${value}"`, 'images');
        }
        continue;
      }
      push(membrete ? { absPath, kind: 'title', cover: false, field, heightMm: alturaMembrete } : { absPath, kind: 'cover', cover, field });
    }
  }
}

export async function collectImageSources(
  content: string,
  fm: Record<string, unknown>,
  docDir: string,
  pageWidthmm: number,
  extraImages: readonly string[] = [],
): Promise<ImageSource[]> {
  const sources: ImageSource[] = [];
  const byPath = new Map<string, ImageSource>();
  const push = (source: ImageSource): void => {
    const previous = byPath.get(source.absPath);
    if (previous !== undefined) {
      if (previous.cover !== true && (source.field === 'extratitle' || source.field === 'frontispiece')) {
        previous.field = source.field;
        previous.kind = source.kind;
        previous.widthMm = source.widthMm ?? previous.widthMm;
        previous.heightMm = source.heightMm ?? previous.heightMm;
      }
      return;
    }
    byPath.set(source.absPath, source);
    sources.push(source);
  };

  await collectFieldSources(fm, docDir, push);

  for (const img of await scanTitlePageFieldImages(fm, docDir, pageWidthmm)) {
    push({ absPath: img.absPath, kind: 'title', cover: false, field: img.field, widthMm: img.widthMm });
  }

  for (const img of scanInlineImageSources(content, docDir, pageWidthmm)) {
    push({ absPath: img.absPath, kind: 'inline', cover: false, widthMm: img.widthMm, heightMm: img.heightMm });
  }
  for (const absPath of extraImages) {
    if (await Bun.file(absPath).exists()) push({ absPath, kind: 'inline', cover: false });
  }
  return sources;
}

interface ImageProfile {
  outputDir: string;
  ext: 'jpg' | 'webp';
  kind: 'pdf' | 'web';
  publish: boolean;
  namePrefix?: string;
  maxWidthPx?: number;
  fallbackMaxWidthPx?: number;
  quality: number;
  fallbackQuality?: number;
  fallbackAlphaQuality?: number;
  maxBytes?: number;
  targetDefine?: string;
  flatten: boolean;
  density300: boolean;
  grayscale: boolean;
  coverColor: boolean;
}

interface Geometry {
  resize?: string;
  extent?: string;
}

function geometryFor(source: ImageSource, profile: ImageProfile, targets: ProcessTargets): Geometry {
  if (profile.kind === 'web') return { resize: `${profile.maxWidthPx ?? 1024}x>` };
  if (source.cover) {
    const w = mmToPx(targets.startpaperW);
    const h = mmToPx(targets.startpaperH);
    return { resize: `${w}x${h}^`, extent: `${w}x${h}` };
  }
  if (source.widthMm !== undefined) return { resize: `${mmToPx(source.widthMm)}>` };
  if (source.heightMm !== undefined) return { resize: `x${mmToPx(source.heightMm)}>` };
  return { resize: `${mmToPx(targets.targetW)}x${mmToPx(targets.targetH)}>` };
}

function grayscaleFor(source: ImageSource, profile: ImageProfile): boolean {
  if (source.field === LETTERHEAD_FIELD) return true;
  if (!profile.grayscale) return false;
  if (profile.coverColor && source.cover && (source.field === 'frontCover' || source.field === 'backCover')) return false;
  return true;
}

interface CachedImage {
  path: string;
  width?: number;
  height?: number;
  bytes: number;
}

const cacheResults = new Map<string, CachedImage>();
const cacheInFlight = new Map<string, Promise<CachedImage | undefined>>();
const sourceHashes = new Map<string, string>();
const publishedThisBuild = new Set<string>();

export function resetImageCache(): void {
  cacheResults.clear();
  cacheInFlight.clear();
  sourceHashes.clear();
  publishedThisBuild.clear();
}

function stemOf(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function safeStem(path: string): string {
  const safe = stemOf(path)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (safe === '' ? 'imagen' : safe).slice(0, 64);
}

async function sourceHash(path: string): Promise<string> {
  const info = await stat(path);
  const key = `${path}:${info.mtimeMs}:${info.size}`;
  const cached = sourceHashes.get(key);
  if (cached !== undefined) return cached;
  const hash = Bun.CryptoHasher.hash('sha256', await Bun.file(path).arrayBuffer(), 'hex');
  sourceHashes.set(key, hash);
  return hash;
}

async function fileSize(path: string): Promise<number> {
  return stat(path)
    .then((info) => info.size)
    .catch(() => 0);
}

async function imageDimensions(path: string): Promise<ImageDimensions | undefined> {
  try {
    const { width, height } = await new Bun.Image(path).metadata();
    return width > 0 && height > 0 ? { width, height } : undefined;
  } catch {
    return undefined;
  }
}

async function readCached(path: string, sidecar: string): Promise<CachedImage | undefined> {
  if (!(await Bun.file(path).exists())) return undefined;
  try {
    const raw = (await Bun.file(sidecar).json()) as { width?: unknown; height?: unknown; bytes?: unknown };
    if (typeof raw.width === 'number' && typeof raw.height === 'number' && typeof raw.bytes === 'number') {
      return { path, width: raw.width, height: raw.height, bytes: raw.bytes };
    }
  } catch {}
  const dimensions = await imageDimensions(path);
  const bytes = await fileSize(path);
  if (bytes === 0) return undefined;
  const result: CachedImage = { path, width: dimensions?.width, height: dimensions?.height, bytes };
  await Bun.write(sidecar, JSON.stringify(result)).catch(() => {});
  return result;
}

async function cacheKey(source: ImageSource, profile: ImageProfile, geometry: Geometry): Promise<string> {
  const spec = {
    resize: geometry.resize ?? null,
    extent: geometry.extent ?? null,
    density300: profile.density300,
    grayscale: grayscaleFor(source, profile),
    quality: profile.quality,
    fallbackQuality: profile.fallbackQuality ?? null,
    fallbackAlphaQuality: profile.fallbackAlphaQuality ?? null,
    targetDefine: profile.targetDefine ?? null,
    flatten: profile.flatten,
    ext: profile.ext,
    isSvg: source.absPath.toLowerCase().endsWith('.svg'),
    maxBytes: profile.maxBytes ?? null,
    fallbackMaxWidthPx: profile.fallbackMaxWidthPx ?? null,
  };
  return Bun.CryptoHasher.hash('sha256', `${source.absPath}:${await sourceHash(source.absPath)}:${JSON.stringify(spec)}`, 'hex');
}

async function processCached(source: ImageSource, profile: ImageProfile, geometry: Geometry, cacheDir: string): Promise<CachedImage | undefined> {
  if (!(await Bun.file(source.absPath).exists())) return undefined;
  const key = await cacheKey(source, profile, geometry);
  const existing = cacheResults.get(key);
  if (existing !== undefined) return existing;
  const inflight = cacheInFlight.get(key);
  if (inflight !== undefined) return inflight;

  const promise = (async (): Promise<CachedImage | undefined> => {
    const path = join(cacheDir, `${key.slice(0, 12)}-${safeStem(source.absPath)}.${profile.ext}`);
    const sidecar = `${path}.json`;
    if (!isScriptCapture()) {
      const cached = await readCached(path, sidecar);
      if (cached !== undefined) {
        cacheResults.set(key, cached);
        return cached;
      }
    }

    const spec: ImageProcessSpec = {
      outPath: path,
      resize: geometry.resize,
      extent: geometry.extent,
      density300: profile.density300,
      grayscale: grayscaleFor(source, profile),
      quality: profile.quality,
      targetDefine: profile.targetDefine,
      flatten: profile.flatten,
    };
    if (!(await processImage(source.absPath, spec))) return undefined;
    let bytes = await fileSize(path);
    if (bytes === 0) return undefined;

    if (profile.maxBytes !== undefined && bytes > profile.maxBytes && profile.fallbackMaxWidthPx !== undefined) {
      const fallbackPath = `${path}.fallback.${profile.ext}`;
      const fallbackSpec: ImageProcessSpec = {
        ...spec,
        outPath: fallbackPath,
        resize: `${profile.fallbackMaxWidthPx}x>`,
        quality: profile.fallbackQuality ?? spec.quality,
        alphaQuality: profile.fallbackAlphaQuality,
      };
      if (await processImage(source.absPath, fallbackSpec)) {
        const fallbackBytes = await fileSize(fallbackPath);
        if (fallbackBytes > 0 && fallbackBytes < bytes) {
          await rm(path, { force: true });
          await rename(fallbackPath, path);
          if (isScriptCapture()) recordSupportCommand('images', path, ['mv', fallbackPath, path]);
          bytes = fallbackBytes;
        } else {
          await rm(fallbackPath, { force: true });
          if (isScriptCapture()) recordSupportCommand('images', fallbackPath, ['rm', '-f', fallbackPath]);
        }
      }
    }

    if (profile.maxBytes !== undefined && bytes > profile.maxBytes) {
      logWarning(
        `la imagen "${basename(path)}" pesa ${Math.round(bytes / 1024)} KB y supera el límite de ${Math.round((profile.maxBytes ?? 0) / 1024)} KB`,
        'images',
      );
    }

    const dimensions = await imageDimensions(path);
    const result: CachedImage = { path, width: dimensions?.width, height: dimensions?.height, bytes };
    await Bun.write(sidecar, JSON.stringify(result)).catch(() => {});
    cacheResults.set(key, result);
    return result;
  })();

  cacheInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    cacheInFlight.delete(key);
  }
}

async function publishWeb(cachePath: string, profile: ImageProfile, published: Set<string>): Promise<string> {
  if (!profile.publish) return cachePath;
  const target = join(profile.outputDir, basename(cachePath));
  if (published.has(target)) return target;
  published.add(target);
  await mkdir(profile.outputDir, { recursive: true });
  if (!(await Bun.file(target).exists())) await copyFile(cachePath, target);
  if (isScriptCapture() && !publishedThisBuild.has(target)) {
    recordSupportCommand('images', target, ['cp', cachePath, target]);
    publishedThisBuild.add(target);
  }
  return target;
}

async function processSources(sources: ImageSource[], profile: ImageProfile, targets: ProcessTargets, cacheDir: string): Promise<ProcessedImages> {
  const imageMap = new Map<string, string>();
  const processedFiles: string[] = [];
  const sizes = new Map<string, ImageDimensions>();
  const names = new Map<string, string>();
  const published = new Set<string>();
  const seenFiles = new Set<string>();

  const processed = await mapWithConcurrency(sources, cpuConcurrency(4), async (source) => {
    const geometry = geometryFor(source, profile, targets);
    return { source, cached: await processCached(source, profile, geometry, cacheDir) };
  });

  for (const { source, cached } of processed) {
    if (cached === undefined) {
      imageMap.set(source.absPath, source.absPath);
      continue;
    }
    const target = await publishWeb(cached.path, profile, published);
    imageMap.set(source.absPath, target);
    if (!seenFiles.has(cached.path)) {
      seenFiles.add(cached.path);
      processedFiles.push(cached.path);
    }
    const sourceName = `${stemOf(source.absPath)}.${profile.ext}`;
    names.set(cached.path, profile.namePrefix === undefined || profile.namePrefix === '' ? sourceName : `${profile.namePrefix}-${sourceName}`);
    if (profile.publish && cached.width !== undefined && cached.height !== undefined) {
      sizes.set(basename(target), { width: cached.width, height: cached.height });
    }
  }

  return { imageMap, processedFiles, sizes, names };
}

function mergeProcessedImages(a: ProcessedImages, b: ProcessedImages): ProcessedImages {
  return {
    imageMap: new Map([...a.imageMap, ...b.imageMap]),
    processedFiles: [...new Set([...a.processedFiles, ...b.processedFiles])],
    sizes: new Map([...a.sizes, ...b.sizes]),
    names: new Map([...a.names, ...b.names]),
  };
}

interface PreprocessArgs {
  cwd: string;
  namePrefix?: string;
  content: string;
  fm: Record<string, unknown>;
  docDir: string;
  pageDimensions: PageDimensions;
  cropActive: boolean;
  pdfxActive: boolean;
  pdfSmall?: boolean;
  dirs: { pdf: string; web: string; epub: string };
  wants: { pdf: boolean; web: boolean; epub: boolean };

  extraImages?: readonly string[];
  detector?: () => Promise<boolean>;
}

export async function preprocessDocumentImages(args: PreprocessArgs): Promise<DocumentImages> {
  const detector = args.detector ?? detectMagick;
  if (!(await detector())) {
    warnMissingMagick(args.pdfxActive);
    return {};
  }
  const sources = await collectImageSources(args.content, args.fm, args.docDir, args.pageDimensions.w, args.extraImages);
  const targets = computeProcessTargets(args.pageDimensions, args.cropActive);
  const coverColor = args.pdfSmall === true ? args.fm.coverColor !== false : false;
  const cacheDir = join(args.cwd, '.iteraciones', 'processed-images');
  const coverWidth = Math.max(1, Math.ceil((args.pageDimensions.w / 25.4) * 150));
  const result: DocumentImages = {};

  if (args.wants.pdf) {
    if (args.pdfSmall !== true) {
      result.pdf = await processSources(
        sources,
        {
          outputDir: args.dirs.pdf,
          ext: 'jpg',
          kind: 'pdf',
          publish: false,
          namePrefix: args.namePrefix,
          quality: 100,
          flatten: true,
          density300: true,
          grayscale: true,
          coverColor,
        },
        targets,
        cacheDir,
      );
    } else {
      const covers = sources.filter((source) => source.cover);
      const titlePages = sources.filter((source) => !source.cover && (source.field === 'extratitle' || source.field === 'frontispiece'));
      const titleSet = new Set(titlePages);
      const rest = sources.filter((source) => !source.cover && !titleSet.has(source));
      const parts: ProcessedImages[] = [];

      if (covers.length > 0) {
        parts.push(
          await processSources(
            covers,
            {
              outputDir: args.dirs.pdf,
              ext: 'jpg',
              kind: 'web',
              publish: false,
              maxWidthPx: coverWidth,
              quality: 70,
              flatten: true,
              density300: false,
              grayscale: true,
              coverColor,
            },
            targets,
            cacheDir,
          ),
        );
      }

      if (titlePages.length > 0) {
        parts.push(
          await processSources(
            titlePages,
            {
              outputDir: args.dirs.pdf,
              ext: 'jpg',
              kind: 'pdf',
              publish: false,
              quality: 70,
              flatten: true,
              density300: true,
              grayscale: true,
              coverColor,
            },
            targets,
            cacheDir,
          ),
        );
      }

      if (rest.length > 0) {
        parts.push(
          await processSources(
            rest,
            {
              outputDir: args.dirs.pdf,
              ext: 'jpg',
              kind: 'web',
              publish: false,
              maxWidthPx: 1280,
              fallbackMaxWidthPx: 420,
              quality: 50,
              fallbackQuality: 20,
              maxBytes: 25 * 1024,
              targetDefine: 'jpeg:extent=25KB',
              flatten: true,
              density300: false,
              grayscale: true,
              coverColor,
            },
            targets,
            cacheDir,
          ),
        );
      }

      let merged: ProcessedImages = { imageMap: new Map(), processedFiles: [], sizes: new Map(), names: new Map() };
      for (const part of parts) merged = mergeProcessedImages(merged, part);
      result.pdf = merged;
    }
  }

  const webEpubSources = sources.filter((source) => source.field !== 'startpaper');

  const processWebEpub = async (opts: {
    outputDir: string;
    ext: 'webp' | 'jpg';
    publish: boolean;
    flatten: boolean;
    restMaxWidthPx: number;
    restQuality: number;
    restFallbackAlphaQuality?: number;
    targetDefine?: string;
  }): Promise<ProcessedImages> => {
    const covers = webEpubSources.filter((source) => source.field === 'frontCover' || source.field === 'backCover');
    const rest = webEpubSources.filter((source) => source.field !== 'frontCover' && source.field !== 'backCover');
    const parts: ProcessedImages[] = [];

    if (covers.length > 0) {
      parts.push(
        await processSources(
          covers,
          {
            outputDir: opts.outputDir,
            ext: opts.ext,
            kind: 'web',
            publish: opts.publish,
            maxWidthPx: coverWidth,
            quality: 70,
            flatten: opts.flatten,
            density300: false,
            grayscale: false,
            coverColor: false,
          },
          targets,
          cacheDir,
        ),
      );
    }

    if (rest.length > 0) {
      parts.push(
        await processSources(
          rest,
          {
            outputDir: opts.outputDir,
            ext: opts.ext,
            kind: 'web',
            publish: opts.publish,
            maxWidthPx: opts.restMaxWidthPx,
            fallbackMaxWidthPx: 420,
            quality: opts.restQuality,
            fallbackQuality: 20,
            fallbackAlphaQuality: opts.restFallbackAlphaQuality,
            maxBytes: 25 * 1024,
            targetDefine: opts.targetDefine,
            flatten: opts.flatten,
            density300: false,
            grayscale: false,
            coverColor: false,
          },
          targets,
          cacheDir,
        ),
      );
    }

    let merged: ProcessedImages = { imageMap: new Map(), processedFiles: [], sizes: new Map(), names: new Map() };
    for (const part of parts) merged = mergeProcessedImages(merged, part);
    return merged;
  };

  if (args.wants.web) {
    result.web = await processWebEpub({
      outputDir: args.dirs.web,
      ext: 'webp',
      publish: true,
      flatten: false,
      restMaxWidthPx: 1280,
      restQuality: 50,
      restFallbackAlphaQuality: 60,
    });
  }

  if (args.wants.epub) {
    result.epub = await processWebEpub({
      outputDir: args.dirs.epub,
      ext: 'jpg',
      publish: false,
      flatten: true,
      restMaxWidthPx: 1024,
      restQuality: 55,
      targetDefine: 'jpeg:extent=25KB',
    });
  }

  return result;
}

export async function processWebImages(
  cwd: string,
  inlineImages: string[],
  outputDir: string,
  pdfxActive = false,
  detector: () => Promise<boolean> = detectMagick,
): Promise<ProcessedImages> {
  if (!(await detector())) {
    warnMissingMagick(pdfxActive);
    return { imageMap: new Map(), processedFiles: [], sizes: new Map(), names: new Map() };
  }
  const sources = [...new Set(inlineImages)].map((absPath): ImageSource => ({ absPath, kind: 'inline', cover: false }));
  return processSources(
    sources,
    {
      outputDir,
      ext: 'webp',
      kind: 'web',
      publish: true,
      maxWidthPx: 1280,
      fallbackMaxWidthPx: 420,
      quality: 50,
      fallbackQuality: 20,
      fallbackAlphaQuality: 60,
      maxBytes: 25 * 1024,
      flatten: false,
      density300: false,
      grayscale: false,
      coverColor: false,
    },
    { targetW: 0, targetH: 0, startpaperW: 0, startpaperH: 0 },
    join(cwd, '.iteraciones', 'processed-images'),
  );
}

export function relImageMapFor(
  imageMap: Map<string, string>,
  base = ASSETS_IMAGES_DIR,
  names?: Map<string, string>,
  fromDir = '.',
  dotSlash = false,
): Map<string, string> {
  const href = dotSlash ? relativePageHref : relativeAssetHref;
  return new Map(
    [...imageMap]
      .filter(([src, dst]) => dst !== src)
      .map(([src, dst]): [string, string] => [src, href(fromDir, `${base}/${names?.get(dst) ?? basename(dst)}`)]),
  );
}
