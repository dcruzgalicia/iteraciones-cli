import { mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { exec, mapWithConcurrency, ProcessSpawnError, ProcessTimeoutError } from '../lib/run.js';

const MM_TO_PX_300DPI = 300 / 25.4;

let magickAvailable: boolean | null = null;

const MAGICK_TIMEOUT_MS = 120_000;

export async function detectMagick(): Promise<boolean> {
  if (magickAvailable !== null) return magickAvailable;
  try {
    const proc = Bun.spawn(['magick', '-version'], { stdout: 'ignore', stderr: 'ignore' });
    magickAvailable = (await proc.exited) === 0;
  } catch {
    magickAvailable = false;
  }
  return magickAvailable;
}

let warnedMissingMagick = false;

export function resetMagickCache(): void {
  magickAvailable = null;
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

export async function processImage(inputPath: string, targetWmm: number, targetHmm: number, cover: boolean, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const outName = `${processedName(inputPath)}.jpg`;
  const outPath = join(outputDir, outName);

  const targetW = mmToPx(targetWmm);
  const targetH = mmToPx(targetHmm);

  let resizeArg: string;
  if (cover) {
    resizeArg = `${targetW}x${targetH}^`;
  } else if (targetH === 0) {
    resizeArg = `${targetW}>`;
  } else {
    resizeArg = `${targetW}x${targetH}>`;
  }

  const isSvg = inputPath.toLowerCase().endsWith('.svg');
  const args: string[] = [];

  if (isSvg) {
    args.push('-density', '300', '-units', 'PixelsPerInch');
  }

  args.push(inputPath, '-resize', resizeArg);

  if (cover) {
    args.push('-gravity', 'center', '-extent', `${targetW}x${targetH}`);
  }

  args.push('-density', '300', '-units', 'PixelsPerInch');
  args.push('-colorspace', 'Gray', '-quality', '100', '-background', 'white', '-flatten', outPath);

  let result: Awaited<ReturnType<typeof exec>>;
  try {
    result = await exec('magick', args, { timeoutMs: MAGICK_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof ProcessSpawnError) {
      logWarning(`ImageMagick no está disponible: se omite el preproceso de "${basename(inputPath)}"`, 'images');
      return inputPath;
    }
    if (err instanceof ProcessTimeoutError) {
      logWarning(
        `ImageMagick no terminó en ${MAGICK_TIMEOUT_MS / 1000}s y fue terminado: se usa la imagen original "${basename(inputPath)}"`,
        'images',
      );
      return inputPath;
    }
    throw err;
  }
  if (result.exitCode !== 0) {
    logWarning(`ImageMagick falló al procesar "${basename(inputPath)}": ${result.stderr.trim()}`, 'images');
    return inputPath;
  }

  return outPath;
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?/g;

const PT_TO_MM = 0.352778;

const PX_TO_MM_96DPI = 25.4 / 96;

function parseWidthMm(attrs: string | undefined, pageWidthmm: number): number | undefined {
  if (!attrs) return undefined;
  const match = attrs.match(/width\s*=\s*([\d.]+)\s*(pt|mm|cm|px|%)/);
  if (!match) return undefined;
  const valueStr = match[1];
  const unit = match[2];
  if (!valueStr || !unit) return undefined;
  const value = Number.parseFloat(valueStr);
  switch (unit) {
    case 'pt':
      return value * PT_TO_MM;
    case 'mm':
      return value;
    case 'cm':
      return value * 10;
    case 'px':
      return value * PX_TO_MM_96DPI;
    case '%':
      return pageWidthmm * (value / 100);
    default:
      return undefined;
  }
}

const MULTILINE_IMAGE_FIELDS = ['lowertitleback', 'uppertitleback', 'dedication', 'extratitle', 'frontispiece', 'titlehead', 'colophon'];

export function scanInlineImages(content: string, docDir: string): string[] {
  const paths: string[] = [];
  for (const match of content.matchAll(MD_IMAGE_RE)) {
    const imgPath = match[2];
    if (!imgPath || isAbsolute(imgPath) || imgPath.startsWith('http')) continue;
    const abs = resolve(docDir, imgPath);
    paths.push(abs);
  }
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
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`\\]\\(${escaped}\\)`, 'g'), () => `](${processed})`);
      result = result.replace(
        new RegExp(`^((?:titleImage|publisherImage|endpapers):[ \\t]*)(["']?)${escaped}(["']?[ \\t]*)$`, 'gm'),
        (_m, pre: string, openQuote: string, closeQuote: string) => `${pre}${openQuote}${processed}${closeQuote}`,
      );
    }
  }
  return result;
}

interface ProcessTargets {
  targetW: number;
  targetH: number;
  endpaperW: number;
  endpaperH: number;
}

export function computeProcessTargets(pageDims: PageDimensions, cropActive: boolean): ProcessTargets {
  return {
    targetW: pageDims.textW + (cropActive ? 6 : 0),
    targetH: pageDims.h + (cropActive ? 6 : 0),
    endpaperW: pageDims.w + (cropActive ? 6 : 0),
    endpaperH: pageDims.h + (cropActive ? 6 : 0),
  };
}

function recordProcessed(imageMap: Map<string, string>, processedFiles: string[], absPath: string, processed: string): void {
  imageMap.set(absPath, processed);
  if (processed !== absPath) processedFiles.push(processed);
}

function magickConcurrency(): number {
  return Math.min(4, Math.max(1, cpus().length));
}

function resolveFmStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}

async function collectFrontmatterImageTasks(
  fm: Record<string, unknown>,
  docDir: string,
  targets: ProcessTargets,
  imageMap: Map<string, string>,
): Promise<{ absPath: string; w: number; h: number; cover: boolean }[]> {
  const tasks: { absPath: string; w: number; h: number; cover: boolean }[] = [];
  for (const field of ['titleImage', 'publisherImage', 'endpapers']) {
    const cover = field === 'endpapers';
    const w = cover ? targets.endpaperW : targets.targetW;
    const h = cover ? targets.endpaperH : targets.targetH;
    for (const value of resolveFmStringArray(fm[field])) {
      const absPath = isAbsolute(value) ? value : resolve(docDir, value);
      if (!(await Bun.file(absPath).exists()) || imageMap.has(absPath)) continue;
      tasks.push({ absPath, w, h, cover });
    }
  }
  return tasks;
}

async function processDedicatedFrontmatterImages(
  fm: Record<string, unknown>,
  docDir: string,
  targets: ProcessTargets,
  outputDir: string,
  imageMap: Map<string, string>,
  processedFiles: string[],
): Promise<void> {
  const tasks = await collectFrontmatterImageTasks(fm, docDir, targets, imageMap);
  await mapWithConcurrency(tasks, magickConcurrency(), async (task) => {
    const processed = await processImage(task.absPath, task.w, task.h, task.cover, outputDir);
    recordProcessed(imageMap, processedFiles, task.absPath, processed);
  });
}

async function processMultilineCoverImages(
  multilineImages: { absPath: string; isSvg: boolean; attrs?: string; widthMm?: number }[],
  targets: ProcessTargets,
  outputDir: string,
  imageMap: Map<string, string>,
  processedFiles: string[],
): Promise<void> {
  const tasks: { absPath: string; w: number; h: number }[] = [];
  const seen = new Set<string>();
  for (const img of multilineImages) {
    if (imageMap.has(img.absPath) || seen.has(img.absPath)) continue;
    seen.add(img.absPath);

    const imgTargetW = img.widthMm ?? targets.targetW;
    const imgTargetH = img.widthMm ? 0 : targets.targetH;
    tasks.push({ absPath: img.absPath, w: imgTargetW, h: imgTargetH });
  }
  await mapWithConcurrency(tasks, magickConcurrency(), async (task) => {
    const processed = await processImage(task.absPath, task.w, task.h, false, outputDir);
    recordProcessed(imageMap, processedFiles, task.absPath, processed);
  });
}

async function processInlineImages(
  inlineImages: string[],
  targets: ProcessTargets,
  outputDir: string,
  imageMap: Map<string, string>,
  processedFiles: string[],
): Promise<void> {
  const tasks = [...new Set(inlineImages)].filter((absPath) => !imageMap.has(absPath));
  await mapWithConcurrency(tasks, magickConcurrency(), async (absPath) => {
    const processed = await processImage(absPath, targets.targetW, targets.targetH, false, outputDir);
    recordProcessed(imageMap, processedFiles, absPath, processed);
  });
}

function warnMissingMagick(pdfxActive: boolean): void {
  if (!warnedMissingMagick) {
    warnedMissingMagick = true;
    logWarning(
      'ImageMagick no disponible; las imágenes no se preprocesaron a escala de grises 300dpi' +
        (pdfxActive ? '; pueden fallar la certificación PDF/X' : ''),
      'images',
    );
  }
}

export async function processDocumentImages(
  inlineImages: string[],
  fm: Record<string, unknown>,
  docDir: string,
  pageDims: PageDimensions,
  cropActive: boolean,
  outputDir: string,
  multilineImages?: { absPath: string; isSvg: boolean; attrs?: string; widthMm?: number }[],
  pdfxActive = false,
  detector: () => Promise<boolean> = detectMagick,
): Promise<{ imageMap: Map<string, string>; processedFiles: string[] }> {
  if (!(await detector())) {
    warnMissingMagick(pdfxActive);
    return { imageMap: new Map(), processedFiles: [] };
  }

  const imageMap = new Map<string, string>();
  const processedFiles: string[] = [];
  const targets = computeProcessTargets(pageDims, cropActive);

  await processDedicatedFrontmatterImages(fm, docDir, targets, outputDir, imageMap, processedFiles);
  if (multilineImages !== undefined) await processMultilineCoverImages(multilineImages, targets, outputDir, imageMap, processedFiles);
  await processInlineImages(inlineImages, targets, outputDir, imageMap, processedFiles);

  return { imageMap, processedFiles };
}
