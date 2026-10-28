import { mkdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { BuildError } from '../lib/errors.js';
import { fmStringList } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { cpuConcurrency, exec, mapWithConcurrency, ProcessSpawnError, ProcessTimeoutError } from '../lib/run.js';
import { resetToolVersionCache, toolVersionMagick } from '../lib/tool-version.js';
import { toMm } from './latex-preamble.js';
import { ASSETS_IMAGES_DIR } from './output-layout.js';

const MM_TO_PX_300DPI = 300 / 25.4;

const MAGICK_TIMEOUT_MS = 120_000;

export async function detectMagick(): Promise<boolean> {
  return (await toolVersionMagick()) !== '';
}

let warnedMissingMagick = false;

export function resetMagickCache(): void {
  resetToolVersionCache();
  warnedMissingMagick = false;
}

export interface PageDimensions {
  w: number;
  h: number;
  textW: number;
}

function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX_300DPI);
}

function processedName(filePath: string): string {
  const name = basename(filePath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
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

export function imageNamerFor(outSlug: string, ext = 'jpg'): (absPath: string) => string {
  const prefix = outSlug === '' ? '' : `${outSlug}-`;
  const taken = new Set<string>();
  const cache = new Map<string, string>();
  return (absPath: string): string => {
    const cached = cache.get(absPath);
    if (cached !== undefined) return cached;
    const base = processedName(absPath);
    const stem = prefix !== '' && base.startsWith(prefix) ? base.slice(prefix.length) : base;
    const name = uniqueName(`${prefix}${stem}.${ext}`, taken);
    cache.set(absPath, name);
    return name;
  };
}

interface ImageProcessSpec {
  outPath: string;
  resize?: string;
  extent?: string;
  density300: boolean;
  grayscale: boolean;
  quality: number;
  maxBytes?: number;
  minQuality?: number;
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
  args.push('-quality', String(quality));
  if (spec.flatten) args.push('-background', 'white', '-flatten');
  args.push(spec.outPath);
  return args;
}

/** Ejecuta magick; si falla, avisa y devuelve false. */
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

async function processImage(inputPath: string, spec: ImageProcessSpec): Promise<string> {
  await mkdir(dirname(spec.outPath), { recursive: true });

  const isSvg = inputPath.toLowerCase().endsWith('.svg');
  const floor = spec.minQuality ?? spec.quality;
  let quality = spec.quality;

  for (let intento = 0; intento < 10; intento++) {
    if (!(await runMagick(inputPath, imageArgs(inputPath, spec, quality, isSvg)))) return inputPath;
    if (spec.maxBytes === undefined) break;
    const size = await stat(spec.outPath)
      .then((s) => s.size)
      .catch(() => 0);
    if (size <= spec.maxBytes || quality <= floor) break;
    quality = Math.max(floor, quality - 10);
  }

  return spec.outPath;
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

export const COVER_IMAGE_FIELDS = ['titleImage', 'publisherImage', 'startpaper', 'frontCover', 'backCover'] as const;

/** Las imágenes de membrete van a 3 cm de ancho, con la altura que pidan. */
export const LETTERHEAD_FIELD = 'letterhead';
export const LETTERHEAD_WIDTH_MM = 30;
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

export function scanInlineImages(content: string, docDir: string): string[] {
  const paths: string[] = [];
  const push = (raw: string | undefined): void => {
    const imgPath = raw?.replace(/^<|>$/g, '');
    if (!imgPath || isAbsolute(imgPath) || imgPath.startsWith('http') || imgPath.startsWith('data:')) return;
    paths.push(resolve(docDir, imgPath));
  };
  for (const match of content.matchAll(MD_IMAGE_RE)) push(match[2]);

  for (const match of content.matchAll(/^\[[^\]]+\]:[ \t]+(\S+)/gm)) {
    if (IMAGE_EXT_RE.test(match[1] ?? '')) push(match[1]);
  }

  for (const match of content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) push(match[1]);
  return paths;
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
  results: { absPath: string; isSvg: boolean; attrs?: string; widthMm?: number }[],
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

    results.push({ absPath: abs, isSvg, attrs, widthMm: parseWidthMm(attrs, pageWidthmm) });
  }
}

export async function scanTitlePageFieldImages(
  fm: Record<string, unknown>,
  docDir: string,
  pageWidthmm = 215.9,
): Promise<{ absPath: string; isSvg: boolean; attrs?: string; widthMm?: number }[]> {
  const results: { absPath: string; isSvg: boolean; attrs?: string; widthMm?: number }[] = [];
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

export function imagePathsMap(imageMap: Map<string, string>, docDir: string, relativize: boolean): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const [absoluteOriginal, processed] of imageMap) {
    if (processed === absoluteOriginal) continue;
    const value = relativize ? `./${ASSETS_IMAGES_DIR}/${basename(processed)}` : processed;
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
}

export interface ProcessedImages {
  imageMap: Map<string, string>;
  processedFiles: string[];
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

/**
 * Reúne todas las imágenes del documento, sin repetir y en orden de prioridad
 * (guardas, después páginas de título, después cuerpo).
 */
export async function collectImageSources(content: string, fm: Record<string, unknown>, docDir: string, pageWidthmm: number): Promise<ImageSource[]> {
  const sources: ImageSource[] = [];
  const seen = new Set<string>();
  const push = (source: ImageSource): void => {
    if (seen.has(source.absPath)) return;
    seen.add(source.absPath);
    sources.push(source);
  };

  for (const field of IMAGE_FIELDS) {
    const cover = FULL_PAGE_COVER_FIELDS.includes(field);
    const membrete = field === LETTERHEAD_FIELD;
    for (const value of fmStringList(fm[field]) ?? []) {
      const absPath = isAbsolute(value) ? value : resolve(docDir, value);
      if (!(await Bun.file(absPath).exists())) continue;
      push(membrete ? { absPath, kind: 'title', cover: false, field, widthMm: LETTERHEAD_WIDTH_MM } : { absPath, kind: 'cover', cover, field });
    }
  }

  for (const img of await scanTitlePageFieldImages(fm, docDir, pageWidthmm)) {
    push({ absPath: img.absPath, kind: 'title', cover: false, widthMm: img.widthMm });
  }

  for (const absPath of scanInlineImages(content, docDir)) push({ absPath, kind: 'inline', cover: false });
  return sources;
}

interface ImageProfile {
  outputDir: string;
  naming: (absPath: string) => string;
  kind: 'pdf' | 'web';
  maxWidthPx?: number;
  quality: number;
  maxBytes?: number;
  minQuality?: number;
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
  if (source.kind === 'title' && source.widthMm !== undefined) return { resize: `${mmToPx(source.widthMm)}>` };
  return { resize: `${mmToPx(targets.targetW)}x${mmToPx(targets.targetH)}>` };
}

function grayscaleFor(source: ImageSource, profile: ImageProfile): boolean {
  // El membrete va siempre en gris, también en los perfiles de color: es una
  // imagen de imprenta y no debe depender del formato que la procese.
  if (source.field === LETTERHEAD_FIELD) return true;
  if (!profile.grayscale) return false;
  if (profile.coverColor && source.cover && (source.field === 'frontCover' || source.field === 'backCover')) return false;
  return true;
}

async function processSources(sources: ImageSource[], profile: ImageProfile, targets: ProcessTargets): Promise<ProcessedImages> {
  const imageMap = new Map<string, string>();
  const processedFiles: string[] = [];
  const processed = await mapWithConcurrency(sources, cpuConcurrency(4), (source) => {
    const geometry = geometryFor(source, profile, targets);
    return processImage(source.absPath, {
      outPath: join(profile.outputDir, profile.naming(source.absPath)),
      resize: geometry.resize,
      extent: geometry.extent,
      density300: profile.density300,
      grayscale: grayscaleFor(source, profile),
      quality: profile.quality,
      maxBytes: profile.maxBytes,
      minQuality: profile.minQuality,
      flatten: profile.flatten,
    });
  });
  for (const [index, result] of processed.entries()) {
    const source = sources[index];
    if (source === undefined || result === undefined) continue;
    imageMap.set(source.absPath, result);
    if (result !== source.absPath) processedFiles.push(result);
  }
  return { imageMap, processedFiles };
}

interface PreprocessArgs {
  content: string;
  fm: Record<string, unknown>;
  docDir: string;
  pageDimensions: PageDimensions;
  cropActive: boolean;
  pdfxActive: boolean;
  outSlug: string;
  dirs: { pdf: string; web: string; epub: string };
  wants: { pdf: boolean; web: boolean; epub: boolean };
  detector?: () => Promise<boolean>;
}

/**
 * Procesa las imágenes del documento en los perfiles pedidos: PDF (JPG a 300
 * dpi, gris) y web/EPUB (WebP o JPG ligeros, color, ancho máximo 1024).
 */
export async function preprocessDocumentImages(args: PreprocessArgs): Promise<DocumentImages> {
  const detector = args.detector ?? detectMagick;
  if (!(await detector())) {
    warnMissingMagick(args.pdfxActive);
    return {};
  }
  const sources = await collectImageSources(args.content, args.fm, args.docDir, args.pageDimensions.w);
  const targets = computeProcessTargets(args.pageDimensions, args.cropActive);
  const coverColor = args.fm.coverColor === true;
  const result: DocumentImages = {};

  if (args.wants.pdf) {
    result.pdf = await processSources(
      sources,
      {
        outputDir: args.dirs.pdf,
        naming: imageNamerFor(args.outSlug, 'jpg'),
        kind: 'pdf',
        quality: 100,
        flatten: true,
        density300: true,
        grayscale: true,
        coverColor,
      },
      targets,
    );
  }

  if (args.wants.web) {
    result.web = await processSources(
      sources,
      {
        outputDir: args.dirs.web,
        naming: imageNamerFor(args.outSlug, 'webp'),
        kind: 'web',
        maxWidthPx: 1024,
        quality: 75,
        maxBytes: 300 * 1024,
        minQuality: 50,
        flatten: false,
        density300: false,
        grayscale: false,
        coverColor: false,
      },
      targets,
    );
  }

  if (args.wants.epub) {
    result.epub = await processSources(
      sources,
      {
        outputDir: args.dirs.epub,
        naming: imageNamerFor(args.outSlug, 'jpg'),
        kind: 'web',
        maxWidthPx: 1024,
        quality: 75,
        maxBytes: 300 * 1024,
        minQuality: 50,
        flatten: true,
        density300: false,
        grayscale: false,
        coverColor: false,
      },
      targets,
    );
  }

  return result;
}

/** Las imágenes del cuerpo de una lista por defecto, en su versión web. */
export async function processWebImages(
  inlineImages: string[],
  outputDir: string,
  naming: (absPath: string) => string,
  pdfxActive = false,
  detector: () => Promise<boolean> = detectMagick,
): Promise<ProcessedImages> {
  if (!(await detector())) {
    warnMissingMagick(pdfxActive);
    return { imageMap: new Map(), processedFiles: [] };
  }
  const sources = [...new Set(inlineImages)].map((absPath): ImageSource => ({ absPath, kind: 'inline', cover: false }));
  return processSources(
    sources,
    {
      outputDir,
      naming,
      kind: 'web',
      maxWidthPx: 1024,
      quality: 75,
      maxBytes: 300 * 1024,
      minQuality: 50,
      flatten: false,
      density300: false,
      grayscale: false,
      coverColor: false,
    },
    { targetW: 0, targetH: 0, startpaperW: 0, startpaperH: 0 },
  );
}

export function relImageMapFor(imageMap: Map<string, string>, base = ASSETS_IMAGES_DIR): Map<string, string> {
  return new Map([...imageMap].filter(([src, dst]) => dst !== src).map(([src, dst]): [string, string] => [src, `./${base}/${basename(dst)}`]));
}
