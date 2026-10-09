import { exists, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { DIST_FILES_DIR } from '../builder/output-layout.js';
import { BuildError } from '../lib/errors.js';
import { fail, logError, logInfo, logSuccess, logWarning } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';
import { plural } from '../lib/plural.js';
import type { VisualDiffResult, VisualOptions } from '../lib/visual-diff.js';
import {
  clearDiffImages,
  compareVisual,
  DIFF_DIR,
  diffTargetFor,
  formatVisualReport,
  formatVisualSummary,
  listPdfFiles,
  referencePathFor,
  resolveVisualOptions,
  resolveVisualWorkspaces,
  saveReference,
  VISUAL_DIR,
  visualSlug,
} from '../lib/visual-diff.js';

export interface TestVisualOptions {
  update?: boolean;
  dpi?: string;
  threshold?: string;
  fuzz?: string;
  output?: string;
}

interface VisualRun {
  visualOptions: VisualOptions;
  explicitReference?: string;
  outputDir: string;
  batch: boolean;
  targets: string[];
}

function labelPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

async function assertExists(path: string, article: string): Promise<void> {
  if (!(await exists(path))) throw new BuildError(`no existe ${article} "${path}"`);
}

async function resolveRun(cwd: string, paths: string[], options: TestVisualOptions): Promise<VisualRun> {
  const visualOptions = resolveVisualOptions(options);
  const snapshotMode = options.update === true;
  const max = snapshotMode ? 1 : 2;
  if (paths.length > max) {
    throw new BuildError(
      snapshotMode
        ? `snapshot admite como mucho una ruta: sin rutas hace todo dist/files (recibidas: ${paths.length})`
        : `check admite como mucho dos rutas: <pdf> <referencia> (recibidas: ${paths.length}) · para varios PDFs usa: iteraciones visual check`,
    );
  }
  if (!snapshotMode && paths.length === 1) {
    throw new BuildError(
      `check necesita dos rutas: el PDF y contra qué compararlo · "${labelPath(cwd, paths[0] as string)}" a secas no dice contra qué snapshot va.\nPara un documento usa: iteraciones visual check (sin rutas, compara ${VISUAL_DIR} contra la salida)\nPara un par: iteraciones visual check <pdf> <referencia>`,
    );
  }

  const outputDir = resolvePath(cwd, options.output ?? DIST_FILES_DIR);
  const [pdf, reference] = paths;
  const batch = pdf === undefined;
  const explicitReference = reference === undefined ? undefined : resolvePath(cwd, reference);
  const targets = batch ? await listPdfFiles(outputDir) : [resolvePath(cwd, pdf)];
  if (batch && targets.length === 0) throw new BuildError(`no hay PDFs en ${labelPath(cwd, outputDir)}`);
  for (const target of targets) await assertExists(target, 'el PDF');
  return { visualOptions, explicitReference, outputDir, batch, targets };
}

async function updateSnapshots(cwd: string, targets: string[], outputDir: string): Promise<void> {
  const store = join(cwd, VISUAL_DIR);
  const wanted = new Set(targets.map((pdf) => referencePathFor(cwd, pdf, outputDir)));
  const removed: string[] = [];
  for (const snapshot of await listPdfFiles(store)) {
    if (wanted.has(snapshot)) continue;
    await rm(snapshot, { force: true });
    removed.push(labelPath(cwd, snapshot));
  }
  for (const pdf of targets) {
    const snapshot = referencePathFor(cwd, pdf, outputDir);
    if (snapshot === pdf) {
      logSuccess(`${labelPath(cwd, pdf)} ya es el snapshot`, 'visual');
      continue;
    }
    await saveReference(pdf, snapshot);
    logSuccess(`${labelPath(cwd, pdf)} → ${labelPath(cwd, snapshot)}`, 'visual');
  }

  await clearDiffImages(join(cwd, DIFF_DIR));
  if (removed.length > 0) logInfo(`snapshots sin PDF en ${labelPath(cwd, outputDir)}: ${removed.join(', ')}`, 'visual');
}

async function seleccionaComparables(
  cwd: string,
  targets: string[],
  outputDir: string,
  batch: boolean,
  explicitReference?: string,
): Promise<string[]> {
  if (explicitReference !== undefined) {
    await assertExists(explicitReference, 'el PDF de referencia');
    return targets;
  }
  const store = join(cwd, VISUAL_DIR);
  const snapshots = new Set(await listPdfFiles(store));

  const wanted = new Set<string>();
  const agregados: string[] = [];
  for (const pdf of targets) {
    const snapshot = referencePathFor(cwd, pdf, outputDir);
    if (snapshots.has(snapshot)) wanted.add(snapshot);
    else agregados.push(labelPath(cwd, pdf));
  }

  const borrados = batch ? [...snapshots].filter((snapshot) => !wanted.has(snapshot)).map((snapshot) => labelPath(cwd, snapshot)) : [];

  if (agregados.length > 0) {
    logInfo(`${plural(agregados.length, 'PDF agregado')} sin snapshot, sin comparación: ${agregados.join(', ')}`, 'visual');
  }
  if (borrados.length > 0) {
    logWarning(`${plural(borrados.length, 'snapshot eliminado')} del build: revisa que sea a propósito · ${borrados.join(', ')}`, 'visual');
  }
  if (batch && snapshots.size === 0) {
    logInfo('no hay snapshots todavía: nada tiene contra qué compararse · crea la línea base con: iteraciones visual snapshot', 'visual');
  }

  return targets.filter((pdf) => wanted.has(referencePathFor(cwd, pdf, outputDir)));
}

async function compareOne(
  cwd: string,
  pdf: string,
  outputDir: string,
  visualOptions: VisualOptions,
  explicitReference?: string,
): Promise<{ referenceLabel: string; result: VisualDiffResult }> {
  const snapshot = referencePathFor(cwd, pdf, outputDir);
  if (explicitReference !== undefined && explicitReference === pdf) {
    throw new BuildError('el PDF y la referencia son el mismo archivo: no hay nada que comparar');
  }
  const { workDir, cachePath } = await resolveVisualWorkspaces(cwd, visualSlug(pdf));
  const { dir, stem } = diffTargetFor(cwd, snapshot);

  await clearDiffImages(dir, stem);
  const result = await compareVisual({
    ...visualOptions,
    reference: explicitReference ?? snapshot,
    generated: pdf,
    workDir,
    cachePath,
    diffDir: dir,
    diffStem: stem,
  });
  return { referenceLabel: labelPath(cwd, explicitReference ?? snapshot), result };
}

function failureSummary(cwd: string, compared: Compared[], failed: Compared[]): string {
  const lines: string[] = [];
  const diffs = failed.flatMap(({ entry }) => entry.result.details.map((detail) => labelPath(cwd, detail.diffImage)));
  if (diffs.length > 0) {
    const images = diffs.length === 1 ? '1 imagen de diferencia' : `${diffs.length} imágenes de diferencia`;
    lines.push(compared.length > 1 ? `${failed.length} de ${compared.length} PDFs con regresión visual · ${images}:` : `${images}:`);
    lines.push(...diffs.map((diff) => `  ${diff}`));
  }
  for (const { pdf, entry } of failed) {
    const { referencePages, generatedPages } = entry.result;
    if (referencePages !== generatedPages) {
      lines.push(`el número de páginas cambió en ${labelPath(cwd, pdf)}: referencia ${referencePages} · generado ${generatedPages}`);
    }
  }
  return lines.join('\n');
}

type Compared = { pdf: string; entry: { referenceLabel: string; result: VisualDiffResult } };

function batchBlock(cwd: string, pdf: string, result: VisualDiffResult): string {
  const [first = '', ...rest] = formatVisualSummary(result, (path) => labelPath(cwd, path));
  return [`${labelPath(cwd, pdf)} · ${first}`, ...rest].join('\n');
}

function reportAll(cwd: string, outputDir: string, options: VisualOptions, compared: Compared[]): void {
  const single = compared.length === 1 ? compared[0] : undefined;
  if (single !== undefined) {
    const { referenceLabel, result } = single.entry;
    logInfo(
      formatVisualReport({ result, options, referenceLabel, generatedLabel: labelPath(cwd, single.pdf) }, (path) => labelPath(cwd, path)),
      'visual',
    );
    return;
  }
  const head = `visual: ${compared.length} PDFs en ${labelPath(cwd, outputDir)} · ${options.dpi} dpi · umbral ${options.thresholdPercent} %`;
  logInfo(`${head} · fuzz ${options.fuzzPercent} %`, 'visual');
  for (const { pdf, entry } of compared) logInfo(batchBlock(cwd, pdf, entry.result), 'visual');
}

function reportVerdict(cwd: string, compared: Compared[]): void {
  const failed = compared.filter(({ entry }) => !entry.result.pass);
  if (failed.length > 0) {
    process.exitCode = 1;
    logError(failureSummary(cwd, compared, failed), 'visual');
    return;
  }
  const single = compared.length === 1 ? compared[0] : undefined;
  if (single !== undefined) {
    logSuccess(
      `sin diferencias visuales en ${single.entry.result.compared} páginas${single.entry.result.fromCache === true ? ' · caché' : ''}`,
      'visual',
    );
    return;
  }
  logSuccess(`sin diferencias visuales en ${compared.length} PDFs`, 'visual');
}

async function compareAll(
  cwd: string,
  targets: string[],
  outputDir: string,
  visualOptions: VisualOptions,
  batch: boolean,
  explicitReference?: string,
): Promise<void> {
  const comparables = await seleccionaComparables(cwd, targets, outputDir, batch, explicitReference);

  const compared: Compared[] = [];
  for (const pdf of comparables) {
    compared.push({ pdf, entry: await compareOne(cwd, pdf, outputDir, visualOptions, explicitReference) });
  }

  if (compared.length === 0) return;

  reportAll(cwd, outputDir, visualOptions, compared);
  reportVerdict(cwd, compared);
}

export async function runTestVisual(cwd: string, paths: string[], options: TestVisualOptions = {}): Promise<void> {
  try {
    const run = await resolveRun(cwd, paths, options);
    if (options.update === true) await updateSnapshots(cwd, run.targets, run.outputDir);
    else await compareAll(cwd, run.targets, run.outputDir, run.visualOptions, run.batch, run.explicitReference);
  } catch (err) {
    fail('visual', err);
  }
}
