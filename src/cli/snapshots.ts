import { exists, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { DIST_FILES_DIR } from '../builder/output-layout.js';
import { BuildError } from '../lib/errors.js';
import { fail, logError, logInfo, logSuccess, logWarning } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';
import { plural } from '../lib/plural.js';
import type { VisualDiffResult } from '../lib/visual-diff.js';
import {
  clearDiffImages,
  clearSnapshotImages,
  compareVisual,
  DIFF_DIR,
  formatVisualReport,
  formatVisualSummary,
  listPdfFiles,
  listSnapshotImages,
  renderPdfPages,
  resolveVisualWorkspaces,
  SNAPSHOTS_DIR,
  savePageImages,
  snapshotStemFor,
  visualSlug,
} from '../lib/visual-diff.js';

export interface SnapshotsOptions {
  output?: string;
}

export type SnapshotsMode = 'save' | 'check';

interface SnapshotRun {
  outputDir: string;
  batch: boolean;
  targets: string[];
  explicitReference?: string;
}

type Compared = { pdf: string; entry: { referenceLabel: string; result: VisualDiffResult } };

function labelPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

async function assertExists(path: string, article: string): Promise<void> {
  if (!(await exists(path))) throw new BuildError(`no existe ${article} "${path}"`);
}

async function resolveRun(cwd: string, paths: string[], mode: SnapshotsMode, options: SnapshotsOptions): Promise<SnapshotRun> {
  const save = mode === 'save';
  const max = save ? 1 : 2;
  if (paths.length > max) {
    throw new BuildError(
      save
        ? `save admite como mucho una ruta: sin rutas hace todo ${DIST_FILES_DIR} (recibidas: ${paths.length})`
        : `check admite como mucho dos rutas: <pdf> <referencia> (recibidas: ${paths.length}) · para varios PDFs usa: iteraciones snapshots check`,
    );
  }
  if (!save && paths.length === 1) {
    throw new BuildError(
      `check necesita dos rutas: el PDF y contra qué compararlo · "${labelPath(cwd, paths[0] as string)}" a secas no dice contra qué snapshot va.\nPara un documento usa: iteraciones snapshots check (sin rutas, compara ${SNAPSHOTS_DIR} contra la salida)\nPara un par: iteraciones snapshots check <pdf> <referencia>`,
    );
  }

  const outputDir = resolvePath(cwd, options.output ?? DIST_FILES_DIR);
  const [pdf, reference] = paths;
  const batch = pdf === undefined;
  const explicitReference = reference === undefined ? undefined : resolvePath(cwd, reference);
  const targets = batch ? await listPdfFiles(outputDir) : [resolvePath(cwd, pdf)];
  if (batch && targets.length === 0) throw new BuildError(`no hay PDFs en ${labelPath(cwd, outputDir)}`);
  for (const target of targets) await assertExists(target, 'el PDF');
  return { outputDir, batch, targets, explicitReference };
}

async function saveSnapshots(cwd: string, targets: string[], outputDir: string, batch: boolean): Promise<void> {
  const store = join(cwd, SNAPSHOTS_DIR);
  const wanted = new Set(targets.map((pdf) => snapshotStemFor(pdf, outputDir)));

  const existentes = await listSnapshotImages(store);
  const retirados = batch ? [...existentes.keys()].filter((stem) => !wanted.has(stem)) : [];
  for (const stem of retirados) await clearSnapshotImages(store, stem);

  let guardados = 0;
  for (const pdf of targets) {
    const stem = snapshotStemFor(pdf, outputDir);
    const { workDir } = await resolveVisualWorkspaces(cwd, visualSlug(pdf));
    await rm(workDir, { recursive: true, force: true });
    const paginas = await renderPdfPages(pdf, join(workDir, 'pag'));
    await clearSnapshotImages(store, stem);
    await savePageImages(paginas, store, stem);
    await rm(workDir, { recursive: true, force: true });
    guardados += paginas.length;
    logSuccess(`${labelPath(cwd, pdf)} → ${SNAPSHOTS_DIR}/${stem} (${plural(paginas.length, 'página')})`, 'snapshots');
  }

  await clearDiffImages(join(cwd, DIFF_DIR));
  if (retirados.length > 0) {
    logInfo(`${plural(retirados.length, 'snapshot retirado')} sin PDF en ${labelPath(cwd, outputDir)}: ${retirados.join(', ')}`, 'snapshots');
  }
  logSuccess(`${plural(guardados, 'página')} en la línea base`, 'snapshots');
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
  const store = join(cwd, SNAPSHOTS_DIR);
  const guardados = await listSnapshotImages(store);

  const agregados: string[] = [];
  for (const pdf of targets) {
    if (!guardados.has(snapshotStemFor(pdf, outputDir))) agregados.push(labelPath(cwd, pdf));
  }

  const wanted = new Set(targets.map((pdf) => snapshotStemFor(pdf, outputDir)));
  const borrados = batch ? [...guardados.keys()].filter((stem) => !wanted.has(stem)) : [];

  if (agregados.length > 0) {
    logInfo(`${plural(agregados.length, 'PDF agregado', 'PDF agregados')} sin snapshot, sin comparación: ${agregados.join(', ')}`, 'snapshots');
  }
  if (borrados.length > 0) {
    logWarning(`${plural(borrados.length, 'snapshot eliminado')} del build: revisa que sea a propósito · ${borrados.join(', ')}`, 'snapshots');
  }
  if (batch && guardados.size === 0) {
    logInfo('no hay snapshots todavía: nada tiene contra qué compararse · crea la línea base con: iteraciones snapshots save', 'snapshots');
  }

  return targets.filter((pdf) => guardados.has(snapshotStemFor(pdf, outputDir)));
}

async function compareOne(
  cwd: string,
  pdf: string,
  outputDir: string,
  explicitReference?: string,
): Promise<{ referenceLabel: string; result: VisualDiffResult }> {
  const store = join(cwd, SNAPSHOTS_DIR);
  const stem = snapshotStemFor(pdf, outputDir);
  const diffDir = join(cwd, DIFF_DIR);
  if (explicitReference !== undefined && explicitReference === pdf) {
    throw new BuildError('el PDF y la referencia son el mismo archivo: no hay nada que comparar');
  }

  const guardados = await listSnapshotImages(store);
  const { workDir, cachePath } = await resolveVisualWorkspaces(cwd, visualSlug(pdf));

  const result = await compareVisual({
    referencePngs: explicitReference === undefined ? guardados.get(stem) : undefined,
    referencePdf: explicitReference,
    generated: pdf,
    workDir,
    cachePath,
    diffDir,
    diffStem: stem,
  });
  return { referenceLabel: explicitReference === undefined ? `${SNAPSHOTS_DIR}/${stem}` : labelPath(cwd, explicitReference), result };
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

function batchBlock(cwd: string, pdf: string, result: VisualDiffResult): string {
  const [first = '', ...rest] = formatVisualSummary(result, (path) => labelPath(cwd, path));
  return [`${labelPath(cwd, pdf)} · ${first}`, ...rest].join('\n');
}

function reportAll(cwd: string, compared: Compared[]): void {
  const single = compared.length === 1 ? compared[0] : undefined;
  if (single !== undefined) {
    const { referenceLabel, result } = single.entry;
    logInfo(
      formatVisualReport({ result, referenceLabel, generatedLabel: labelPath(cwd, single.pdf) }, (path) => labelPath(cwd, path)),
      'snapshots',
    );
    return;
  }
  logInfo(`visual: ${compared.length} PDFs comparados contra ${SNAPSHOTS_DIR}`, 'snapshots');
  for (const { pdf, entry } of compared) logInfo(batchBlock(cwd, pdf, entry.result), 'snapshots');
}

function reportVerdict(cwd: string, compared: Compared[]): void {
  const failed = compared.filter(({ entry }) => !entry.result.pass);
  if (failed.length > 0) {
    process.exitCode = 1;
    logError(failureSummary(cwd, compared, failed), 'snapshots');
    return;
  }
  const single = compared.length === 1 ? compared[0] : undefined;
  if (single !== undefined) {
    logSuccess(
      `sin diferencias visuales en ${single.entry.result.compared} páginas${single.entry.result.fromCache === true ? ' · caché' : ''}`,
      'snapshots',
    );
    return;
  }
  logSuccess(`sin diferencias visuales en ${compared.length} PDFs`, 'snapshots');
}

async function checkAll(cwd: string, run: SnapshotRun): Promise<void> {
  await clearDiffImages(join(cwd, DIFF_DIR));
  const comparables = await seleccionaComparables(cwd, run.targets, run.outputDir, run.batch, run.explicitReference);

  const compared: Compared[] = [];
  for (const pdf of comparables) {
    compared.push({ pdf, entry: await compareOne(cwd, pdf, run.outputDir, run.explicitReference) });
  }

  if (compared.length === 0) return;

  reportAll(cwd, compared);
  reportVerdict(cwd, compared);
}

export async function runSnapshots(cwd: string, paths: string[], mode: SnapshotsMode, options: SnapshotsOptions = {}): Promise<void> {
  try {
    const run = await resolveRun(cwd, paths, mode, options);
    if (mode === 'save') await saveSnapshots(cwd, run.targets, run.outputDir, run.batch);
    else await checkAll(cwd, run);
  } catch (err) {
    fail('snapshots', err);
  }
}
