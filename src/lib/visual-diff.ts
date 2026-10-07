import { createHash } from 'node:crypto';
import { copyFile, exists, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path';
import slugifyLib from 'slugify';
import { BuildError } from './errors.js';
import { exec, mapWithConcurrency } from './run.js';

export interface VisualOptions {
  dpi: number;

  thresholdPercent: number;

  fuzzPercent: number;
}

export const VISUAL_DEFAULTS: VisualOptions = { dpi: 300, thresholdPercent: 0.005, fuzzPercent: 15 };

function parseOption(raw: string | undefined, fallback: number, flag: string, valid: (n: number) => boolean, hint: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !valid(value)) throw new BuildError(`${flag} inválido: "${raw}" (se espera ${hint})`);
  return value;
}

export function resolveVisualOptions(raw: { dpi?: string; threshold?: string; fuzz?: string } = {}): VisualOptions {
  return {
    dpi: parseOption(raw.dpi, VISUAL_DEFAULTS.dpi, '--dpi', (n) => Number.isInteger(n) && n >= 1, 'un entero >= 1'),
    thresholdPercent: parseOption(
      raw.threshold,
      VISUAL_DEFAULTS.thresholdPercent,
      '--threshold',
      (n) => n >= 0 && n <= 100,
      'un valor entre 0 y 100',
    ),
    fuzzPercent: parseOption(raw.fuzz, VISUAL_DEFAULTS.fuzzPercent, '--fuzz', (n) => n >= 0 && n <= 100, 'un valor entre 0 y 100'),
  };
}

export function blurSigmaFor(dpi: number): number {
  return dpi / 150;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function pageNumberOf(file: string): number {
  const match = /-(\d+)\.png$/.exec(file);
  return match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
}

export function sortPageFiles(files: string[]): string[] {
  return [...files].sort((a, b) => pageNumberOf(a) - pageNumberOf(b));
}

export function visualSlug(pdfPath: string): string {
  const slug = slugifyLib(basename(pdfPath, extname(pdfPath)), { lower: true, strict: true });
  return slug === '' ? 'documento' : slug;
}

export function referencePathFor(cwd: string, pdfPath: string, outputDir: string): string {
  const rel = relative(outputDir, pdfPath);
  const insideOutput = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  return insideOutput ? join(cwd, 'visual', dirname(rel), `${visualSlug(rel)}.pdf`) : join(cwd, 'visual', `${visualSlug(pdfPath)}.pdf`);
}

export function diffImageName(stem: string, page: number): string {
  return `${stem}-page-${String(page).padStart(3, '0')}-diff.png`;
}

export function diffTargetFor(snapshotPath: string): { dir: string; stem: string } {
  return { dir: dirname(snapshotPath), stem: basename(snapshotPath, extname(snapshotPath)) };
}

async function walkFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  await walk(dir);
  return found.sort();
}

export async function listPdfFiles(dir: string): Promise<string[]> {
  return (await walkFiles(dir)).filter((file) => extname(file).toLowerCase() === '.pdf');
}

const DIFF_IMAGE = /-page-\d+-diff\.png$/;

export async function clearDiffImages(dir: string, stem?: string): Promise<void> {
  const files = stem === undefined ? await walkFiles(dir) : (await readdir(dir).catch(() => [])).map((f) => join(dir, f));
  const pattern = stem === undefined ? DIFF_IMAGE : new RegExp(`^${escapeRegExp(stem)}-page-\\d+-diff\\.png$`);
  await Promise.all(files.filter((file) => pattern.test(basename(file))).map((file) => forceUnlink(file)));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface VisualWorkspaces {
  workDir: string;

  cachePath: string;
}

export async function resolveVisualWorkspaces(cwd: string, slug: string): Promise<VisualWorkspaces> {
  const base = (await exists(join(cwd, 'iteraciones.config.yaml')))
    ? join(cwd, '.iteraciones', 'tmp', 'visual')
    : join(tmpdir(), 'iteraciones-visual');
  return { workDir: join(base, slug), cachePath: join(base, 'cache.json') };
}

export interface PageDiff {
  page: number;
  diffPercent: number;
  diffImage: string;
}

export interface VisualDiffResult {
  compared: number;
  unchanged: number;
  changed: number;
  details: PageDiff[];
  referencePages: number;
  generatedPages: number;
  pass: boolean;

  diffDir?: string;

  fromCache?: boolean;
}

interface CacheEntry {
  compared: number;
  unchanged: number;
  changed: number;
  referencePages: number;
  generatedPages: number;
  pass: boolean;
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function cacheKey(hashes: { reference: string; generated: string }, options: VisualOptions): string {
  const basis = `${hashes.reference}:${hashes.generated}:${options.dpi}:${options.fuzzPercent}:${options.thresholdPercent}`;
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

async function readCache(path: string): Promise<Record<string, CacheEntry>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

async function writeCache(path: string, key: string, entry: CacheEntry): Promise<void> {
  try {
    const current = await readCache(path);
    current[key] = entry;
    const trimmed = Object.fromEntries(Object.entries(current).slice(-50));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  } catch {}
}

async function forceUnlink(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}

async function renderPdf(pdf: string, prefix: string, dpi: number): Promise<string[]> {
  const dir = dirname(prefix);
  const result = await exec('pdftoppm', ['-r', String(dpi), '-png', pdf, prefix]);
  if (result.exitCode !== 0) {
    throw new BuildError(`pdftoppm no pudo renderizar "${pdf}": ${result.stderr.trim().split('\n').pop() ?? 'error desconocido'}`);
  }
  const stem = basename(prefix);
  const pages = (await readdir(dir)).filter((f) => f.startsWith(`${stem}-`) && f.endsWith('.png')).map((f) => join(dir, f));
  return sortPageFiles(pages);
}

async function blurPage(source: string, target: string, sigma: number): Promise<void> {
  const blur = await exec('magick', [source, '-blur', `0x${sigma}`, target]);
  if (blur.exitCode !== 0) {
    throw new BuildError(`magick no pudo difuminar "${source}": ${blur.stderr.trim().split('\n').pop() ?? 'error desconocido'}`);
  }
}

async function comparePngPair(
  referencePng: string,
  generatedPng: string,
  diffImage: string,
  options: VisualOptions,
  tmpDir: string,
): Promise<number> {
  const size = pngSize(await readFile(referencePng));
  if (size === null) throw new BuildError(`"${referencePng}" no es un PNG válido`);

  const sigma = blurSigmaFor(options.dpi);
  const blurBase = join(tmpDir, `blur-${basename(diffImage)}`);
  const blurredReference = `${blurBase}-a.png`;
  const blurredGenerated = `${blurBase}-b.png`;
  await blurPage(referencePng, blurredReference, sigma);
  await blurPage(generatedPng, blurredGenerated, sigma);

  const compare = await exec('magick', [
    'compare',
    '-metric',
    'AE',
    '-fuzz',
    `${options.fuzzPercent}%`,
    blurredReference,
    blurredGenerated,
    diffImage,
  ]);
  if (compare.exitCode > 1) {
    throw new BuildError(`magick compare falló: ${compare.stderr.trim().split('\n').pop() ?? 'error desconocido'}`);
  }
  await Promise.all([forceUnlink(blurredReference), forceUnlink(blurredGenerated)]);

  const metricLine = (compare.stderr.trim() !== '' ? compare.stderr : compare.stdout).trim().split('\n').pop() ?? '';
  const differing = Number.parseFloat(metricLine);
  if (!Number.isFinite(differing)) throw new BuildError(`no se pudo leer la métrica de magick compare: "${metricLine}"`);
  return (100 * differing) / (size.width * size.height);
}

export interface CompareVisualInput extends VisualOptions {
  reference: string;
  generated: string;
  workDir: string;
  cachePath?: string;

  diffDir?: string;

  diffStem?: string;
}

export async function compareVisual(input: CompareVisualInput): Promise<VisualDiffResult> {
  const options: VisualOptions = {
    dpi: input.dpi,
    thresholdPercent: input.thresholdPercent,
    fuzzPercent: input.fuzzPercent,
  };
  const key = cacheKey({ reference: await hashFile(input.reference), generated: await hashFile(input.generated) }, options);
  if (input.cachePath !== undefined) {
    const cached = (await readCache(input.cachePath))[key];
    if (cached !== undefined) return { ...cached, details: [], fromCache: true };
  }

  await rm(input.workDir, { recursive: true, force: true });
  await mkdir(input.workDir, { recursive: true });
  const diffDir = input.diffDir ?? input.workDir;
  const diffStem = input.diffStem ?? 'documento';
  if (diffDir !== input.workDir) await mkdir(diffDir, { recursive: true });

  const referencePages = await renderPdf(input.reference, join(input.workDir, 'ref'), options.dpi);
  const generatedPages = await renderPdf(input.generated, join(input.workDir, 'gen'), options.dpi);
  const compared = Math.min(referencePages.length, generatedPages.length);
  const details: PageDiff[] = [];

  await mapWithConcurrency(
    Array.from({ length: compared }, (_, index) => index),
    4,
    async (index) => {
      const referencePng = referencePages[index];
      const generatedPng = generatedPages[index];
      if (referencePng === undefined || generatedPng === undefined) return;
      const page = index + 1;
      const diffImage = join(diffDir, diffImageName(diffStem, page));
      const diffPercent = await comparePngPair(referencePng, generatedPng, diffImage, options, input.workDir);
      if (diffPercent <= options.thresholdPercent) {
        await Promise.all([forceUnlink(referencePng), forceUnlink(generatedPng), forceUnlink(diffImage)]);
        return;
      }

      await Promise.all([forceUnlink(referencePng), forceUnlink(generatedPng)]);
      details.push({ page, diffPercent, diffImage });
    },
  );

  for (const entry of await readdir(input.workDir)) {
    if (/^(ref|gen)-\d+\.png$/.test(entry)) await forceUnlink(join(input.workDir, entry));
  }

  details.sort((a, b) => a.page - b.page);
  const changed = details.length;
  const unchanged = compared - changed;
  const pass = changed === 0 && referencePages.length === generatedPages.length;
  const result: VisualDiffResult = {
    compared,
    unchanged,
    changed,
    details,
    referencePages: referencePages.length,
    generatedPages: generatedPages.length,
    pass,

    ...(changed > 0 ? { diffDir } : {}),
  };

  if (!(diffDir === input.workDir && changed > 0)) await rm(input.workDir, { recursive: true, force: true });
  if (pass && input.cachePath !== undefined) {
    const entry: CacheEntry = {
      compared,
      unchanged,
      changed,
      referencePages: referencePages.length,
      generatedPages: generatedPages.length,
      pass,
    };
    await writeCache(input.cachePath, key, entry);
  }
  return result;
}

export async function saveReference(generated: string, storePath: string): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true });
  if (generated !== storePath) await copyFile(generated, storePath);
}

export interface VisualReport {
  result: VisualDiffResult;
  options: VisualOptions;
  referenceLabel: string;
  generatedLabel: string;
}

export function formatVisualSummary(result: VisualDiffResult, label?: (path: string) => string): string[] {
  const name = label ?? ((path: string) => path);
  const lines = [`páginas ${result.compared} · sin cambios ${result.unchanged} · modificadas ${result.changed}`];
  if (result.referencePages !== result.generatedPages) {
    lines.push(`páginas distintas: referencia ${result.referencePages} · generado ${result.generatedPages}`);
  }
  for (const detail of result.details) {
    lines.push(`  pág ${detail.page}  ${detail.diffPercent.toFixed(4)} %  ${name(detail.diffImage)}`);
  }
  return lines;
}

export function formatVisualReport(report: VisualReport, label?: (path: string) => string): string {
  const { result, options, referenceLabel, generatedLabel } = report;
  return [
    `visual: ${generatedLabel} vs ${referenceLabel} · ${options.dpi} dpi · umbral ${options.thresholdPercent} % · fuzz ${options.fuzzPercent} %`,
    ...formatVisualSummary(result, label),
  ].join('\n');
}
