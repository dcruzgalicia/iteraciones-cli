import { copyFile, exists, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path';
import slugifyLib from 'slugify';
import { hashFileContent, hashString } from '../builder/state-serialize.js';
import { BuildError } from './errors.js';
import { escapeRegExp } from './paths.js';
import { exec, mapWithConcurrency } from './run.js';

export const DPI = 300;
export const FUZZ_PERCENT = 0;
export const THRESHOLD_PERCENT = 0;

export const REMOVED_TINT = '#2E8B57';
export const REMOVED_BLEND = '45';
export const ADDED_TINT = '#C0392B';
export const ADDED_BLEND = '15';

const GHOST_LIFT = '0.2';
const GHOST_OFFSET = '52428';

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

export const SNAPSHOTS_DIR = 'snapshots';
export const DIFF_DIR = 'diff';
const DIFF_IMAGE = /--page-\d+--diff\.png$/;
const SNAPSHOT_IMAGE = /--page-\d+\.png$/;

export function visualSlug(pdfPath: string): string {
  const slug = slugifyLib(basename(pdfPath, extname(pdfPath)), { lower: true, strict: true });
  return slug === '' ? 'documento' : slug;
}

/** El prefijo aplanado bajo el que viven las páginas de este PDF en snapshots/ y diff/. */
export function snapshotStemFor(pdfPath: string, outputDir: string): string {
  const rel = relative(outputDir, pdfPath);
  const insideOutput = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  return insideOutput ? aplanar(rel) : visualSlug(pdfPath);
}

function aplanar(rel: string): string {
  const sinExt = rel.slice(0, rel.length - extname(rel).length);
  return sinExt
    .split(/[\\/]/)
    .map((segmento) => segmento.replace(/-{2,}/g, '-'))
    .join('--');
}

export function snapshotImageName(stem: string, page: number): string {
  return `${stem}--page-${String(page).padStart(3, '0')}.png`;
}

export function diffImageName(stem: string, page: number): string {
  return `${stem}--page-${String(page).padStart(3, '0')}--diff.png`;
}

function stemOf(file: string): string {
  return file.replace(SNAPSHOT_IMAGE, '');
}

async function globFiles(dir: string, pattern: string): Promise<string[]> {
  if (
    !(
      await Bun.file(dir)
        .stat()
        .catch(() => null)
    )?.isDirectory()
  )
    return [];
  const found: string[] = [];
  for await (const rel of new Bun.Glob(pattern).scan({ cwd: dir, onlyFiles: true })) {
    found.push(join(dir, rel));
  }
  return found.sort();
}

export async function listPdfFiles(dir: string): Promise<string[]> {
  return globFiles(dir, '**/*.pdf');
}

export async function clearDiffImages(dir: string, stem?: string): Promise<void> {
  const files = stem === undefined ? await globFiles(dir, '**/*--page-*-diff.png') : (await readdir(dir).catch(() => [])).map((f) => join(dir, f));
  const pattern = stem === undefined ? DIFF_IMAGE : new RegExp(`^${escapeRegExp(stem)}--page-\\d+--diff\\.png$`);
  await Promise.all(files.filter((file) => pattern.test(basename(file))).map((file) => forceUnlink(file)));
}

export async function clearSnapshotImages(dir: string, stem?: string): Promise<void> {
  const files = stem === undefined ? await globFiles(dir, '**/*--page-*.png') : (await readdir(dir).catch(() => [])).map((f) => join(dir, f));
  const pattern = stem === undefined ? SNAPSHOT_IMAGE : new RegExp(`^${escapeRegExp(stem)}--page-\\d+\\.png$`);
  await Promise.all(files.filter((file) => pattern.test(basename(file))).map((file) => forceUnlink(file)));
}

/** Prefijo aplanado → sus páginas, ordenadas. Es la línea base completa de un documento. */
export async function listSnapshotImages(dir: string): Promise<Map<string, string[]>> {
  const porStem = new Map<string, string[]>();
  for (const file of await globFiles(dir, '**/*--page-*.png')) {
    const base = basename(file);
    if (!SNAPSHOT_IMAGE.test(base)) continue;
    const stem = stemOf(base);
    const paginas = porStem.get(stem);
    if (paginas === undefined) porStem.set(stem, [file]);
    else paginas.push(file);
  }
  return new Map([...porStem].map(([stem, files]) => [stem, sortPageFiles(files)]));
}

interface VisualWorkspaces {
  workDir: string;

  cachePath: string;
}

export async function resolveVisualWorkspaces(cwd: string, slug: string): Promise<VisualWorkspaces> {
  const base = (await exists(join(cwd, 'iteraciones.config.yaml')))
    ? join(cwd, '.iteraciones', 'tmp', 'snapshots')
    : join(tmpdir(), 'iteraciones-snapshots', hashString(cwd).slice(0, 12));
  return { workDir: join(base, slug), cachePath: join(base, 'cache.json') };
}

interface PageDiff {
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

function cacheKey(hashes: { reference: string; generated: string }): string {
  return hashString(`${hashes.reference}:${hashes.generated}:${DPI}:${FUZZ_PERCENT}:${THRESHOLD_PERCENT}`).slice(0, 32);
}

async function readCache(path: string): Promise<Record<string, CacheEntry>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

let cacheWrite = Promise.resolve();

async function writeCache(path: string, key: string, entry: CacheEntry): Promise<void> {
  cacheWrite = cacheWrite.then(async () => {
    try {
      const current = await readCache(path);
      current[key] = entry;
      const trimmed = Object.fromEntries(Object.entries(current).slice(-50));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
    } catch {}
  });
  return cacheWrite;
}

async function forceUnlink(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}

export async function renderPdfPages(pdf: string, prefix: string): Promise<string[]> {
  const dir = dirname(prefix);
  await mkdir(dir, { recursive: true });
  const result = await exec('pdftoppm', ['-r', String(DPI), '-png', pdf, prefix]);
  if (result.exitCode !== 0) {
    throw new BuildError(`pdftoppm no pudo renderizar "${pdf}": ${result.stderr.trim().split('\n').pop() ?? 'error desconocido'}`);
  }
  const stem = basename(prefix);
  const pages = (await readdir(dir)).filter((f) => f.startsWith(`${stem}-`) && f.endsWith('.png')).map((f) => join(dir, f));
  return sortPageFiles(pages);
}

interface PngPair {
  referencePng: string;
  generatedPng: string;
  diffImage: string;
  scratch: string;
}

async function magick(args: string[]): Promise<void> {
  const result = await exec('magick', args);
  if (result.exitCode !== 0) {
    throw new BuildError(`magick falló pintando el diff: ${result.stderr.trim().split('\n').pop() ?? 'error desconocido'}`);
  }
}

async function paintDiffImage(args: PngPair): Promise<void> {
  await mkdir(args.scratch, { recursive: true });
  const at = (name: string): string => join(args.scratch, name);
  await magick([args.referencePng, args.generatedPng, '-compose', 'Minus', '-composite', '-threshold', '1', at('borrado.miff')]);
  await magick([args.generatedPng, args.referencePng, '-compose', 'Minus', '-composite', '-threshold', '1', at('agregado.miff')]);
  await magick([args.referencePng, '-evaluate', 'Multiply', GHOST_LIFT, '-evaluate', 'Add', GHOST_OFFSET, at('base.miff')]);
  await magick([at('base.miff'), '-fill', REMOVED_TINT, '-colorize', REMOVED_BLEND, at('verde.miff')]);
  await magick([at('base.miff'), '-fill', ADDED_TINT, '-colorize', ADDED_BLEND, at('rosa.miff')]);
  await magick([at('verde.miff'), at('borrado.miff'), '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', at('capa-verde.miff')]);
  await magick([at('rosa.miff'), at('agregado.miff'), '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', at('capa-rosa.miff')]);
  await magick([at('base.miff'), at('capa-rosa.miff'), '-compose', 'Over', '-composite', at('mitad.miff')]);
  await magick([at('mitad.miff'), at('capa-verde.miff'), '-compose', 'Over', '-composite', args.diffImage]);
}

async function comparePngPair(args: PngPair): Promise<number> {
  const size = pngSize(await readFile(args.referencePng));
  if (size === null) throw new BuildError(`"${args.referencePng}" no es un PNG válido`);

  const compare = await exec('magick', ['compare', '-metric', 'AE', '-fuzz', `${FUZZ_PERCENT}%`, args.referencePng, args.generatedPng, 'null:']);
  if (compare.exitCode > 1) {
    throw new BuildError(`magick compare falló: ${compare.stderr.trim().split('\n').pop() ?? 'error desconocido'}`);
  }

  const metricLine = (compare.stderr.trim() !== '' ? compare.stderr : compare.stdout).trim().split('\n').pop() ?? '';
  const differing = Number.parseFloat(metricLine);
  if (!Number.isFinite(differing)) throw new BuildError(`no se pudo leer la métrica de magick compare: "${metricLine}"`);
  const diffPercent = (100 * differing) / (size.width * size.height);
  if (diffPercent > THRESHOLD_PERCENT) await paintDiffImage(args);
  return diffPercent;
}

interface CompareVisualInput {
  referencePngs?: string[];
  referencePdf?: string;
  generated: string;
  workDir: string;
  cachePath?: string;

  diffDir?: string;

  diffStem?: string;
}

async function cacheResult(path: string, key: string, result: VisualDiffResult): Promise<void> {
  const { compared, unchanged, changed, referencePages, generatedPages, pass } = result;
  await writeCache(path, key, { compared, unchanged, changed, referencePages, generatedPages, pass });
}

async function comparePages(args: {
  referencePages: string[];
  generatedPages: string[];
  compared: number;
  diffDir: string;
  diffStem: string;
  workDir: string;
}): Promise<PageDiff[]> {
  const details: PageDiff[] = [];
  await mapWithConcurrency(
    Array.from({ length: args.compared }, (_, index) => index),
    4,
    async (index) => {
      const referencePng = args.referencePages[index];
      const generatedPng = args.generatedPages[index];
      if (referencePng === undefined || generatedPng === undefined) return;
      const page = index + 1;
      const diffImage = join(args.diffDir, diffImageName(args.diffStem, page));
      const diffPercent = await comparePngPair({
        referencePng,
        generatedPng,
        diffImage,
        scratch: join(args.workDir, `diff-${page}`),
      });
      await forceUnlink(generatedPng);
      if (diffPercent > THRESHOLD_PERCENT) details.push({ page, diffPercent, diffImage });
    },
  );
  return details;
}

async function hashFiles(paths: string[]): Promise<string> {
  const parts: string[] = [];
  for (const path of paths) parts.push(path, await hashFileContent(path));
  return hashString(parts.join('\0'));
}

export async function compareVisual(input: CompareVisualInput): Promise<VisualDiffResult> {
  if (input.referencePngs === undefined && input.referencePdf === undefined) {
    throw new BuildError('compareVisual necesita la referencia como imágenes o como PDF');
  }
  const referenceHash =
    input.referencePngs === undefined ? await hashFileContent(input.referencePdf as string) : await hashFiles(input.referencePngs);
  const key = cacheKey({ reference: referenceHash, generated: await hashFileContent(input.generated) });
  const cached = input.cachePath === undefined ? undefined : (await readCache(input.cachePath))[key];
  if (cached !== undefined) return { ...cached, details: [], fromCache: true };

  const diffDir = input.diffDir ?? input.workDir;
  const diffStem = input.diffStem ?? 'documento';
  await mkdir(diffDir, { recursive: true });
  await rm(input.workDir, { recursive: true, force: true });
  await mkdir(input.workDir, { recursive: true });

  const referencePages = input.referencePngs ?? (await renderPdfPages(input.referencePdf as string, join(input.workDir, 'ref')));
  const generatedPages = await renderPdfPages(input.generated, join(input.workDir, 'gen'));
  const compared = Math.min(referencePages.length, generatedPages.length);
  const details = await comparePages({ referencePages, generatedPages, compared, diffDir, diffStem, workDir: input.workDir });

  details.sort((a, b) => a.page - b.page);
  const changed = details.length;
  const unchanged = compared - changed;
  const referenceCount = referencePages.length;
  const pass = changed === 0 && referenceCount === generatedPages.length;
  const result: VisualDiffResult = {
    compared,
    unchanged,
    changed,
    details,
    referencePages: referenceCount,
    generatedPages: generatedPages.length,
    pass,

    ...(changed > 0 ? { diffDir } : {}),
  };

  const keepWorkDir = diffDir === input.workDir && changed > 0;
  try {
    if (pass && input.cachePath !== undefined) await cacheResult(input.cachePath, key, result);
  } finally {
    if (!keepWorkDir) await rm(input.workDir, { recursive: true, force: true });
  }
  return result;
}

export async function savePageImages(rendered: string[], destDir: string, stem: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  for (const [index, png] of rendered.entries()) {
    await copyFile(png, join(destDir, snapshotImageName(stem, index + 1)));
  }
}

interface VisualReport {
  result: VisualDiffResult;
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
  const { result, referenceLabel, generatedLabel } = report;
  return [
    `visual: ${generatedLabel} vs ${referenceLabel} · ${DPI} dpi · umbral ${THRESHOLD_PERCENT} % · fuzz ${FUZZ_PERCENT} %`,
    ...formatVisualSummary(result, label),
  ].join('\n');
}
