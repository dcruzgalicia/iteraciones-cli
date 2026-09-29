import { exists, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { DIST_FILES_DIR } from '../builder/output-layout.js';
import { BuildError } from '../lib/errors.js';
import { logError, logInfo, logSuccess, logWarning } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';
import type { VisualDiffResult, VisualOptions } from '../lib/visual-diff.js';
import {
  clearDiffImages,
  compareVisual,
  diffTargetFor,
  formatVisualReport,
  formatVisualSummary,
  listPdfFiles,
  referencePathFor,
  resolveVisualOptions,
  resolveVisualWorkspaces,
  saveReference,
  visualSlug,
} from '../lib/visual-diff.js';

/**
 * #2479 — `iteraciones test visual [pdf...]`: regresión visual de los PDFs.
 *
 * El flujo es build → `--update` → cambios → build → comparar, y se puede hacer
 * de una vez para todo el proyecto:
 * - `--update` guarda como snapshot los PDFs de `--output` (o los que se le
 *   pasen) en `visual/`, espejando la estructura de la salida, y retira los
 *   snapshots y diffs sobrantes;
 * - sin PDFs compara todos los de `--output` contra sus snapshots y se niega a
 *   comparar nada si falta alguno: un parcial esconde la regresión;
 * - con PDFs explícitos compara solo esos, y `--reference` permite sustituir
 *   el snapshot por un PDF cualquiera.
 *
 * El resumen trae, por PDF, las páginas comparadas, sin cambios y modificadas,
 * el % de píxeles distintos de cada página afectada y la ruta de su imagen de
 * diferencia, que vive en `visual/` junto al snapshot (`index.pdf` →
 * `index-page-005-diff.png`); los renders no se conservan.
 */
export interface TestVisualOptions {
  reference?: string;
  update?: boolean;
  dpi?: string;
  threshold?: string;
  fuzz?: string;
  output?: string;
}

/** Todo lo que hay que resolver antes de guardar o comparar. */
interface VisualRun {
  visualOptions: VisualOptions;
  explicitReference?: string;
  outputDir: string;
  batch: boolean;
  targets: string[];
}

/** Ruta etiqueta: relativa a la raíz cuando vive dentro, absoluta si se sale. */
function labelPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

async function assertExists(path: string, article: string): Promise<void> {
  if (!(await exists(path))) throw new BuildError(`no existe ${article} "${path}"`);
}

/** Comprueba flags y destinos: sin PDFs, el modo lote mira `--output`. */
async function resolveRun(cwd: string, pdfs: string[], options: TestVisualOptions): Promise<VisualRun> {
  const visualOptions = resolveVisualOptions(options);
  const explicitReference = options.reference === undefined || options.reference === '' ? undefined : resolvePath(cwd, options.reference);
  if (options.update === true && explicitReference !== undefined) {
    throw new BuildError('--update y --reference son incompatibles: --update guarda el PDF generado como snapshot');
  }
  const batch = pdfs.length === 0;
  if (batch && explicitReference !== undefined) {
    throw new BuildError('--reference necesita un PDF explícito: el modo lote solo compara contra los snapshots de visual/');
  }

  const outputDir = resolvePath(cwd, options.output ?? DIST_FILES_DIR);
  const targets = batch ? await listPdfFiles(outputDir) : pdfs.map((pdf) => resolvePath(cwd, pdf));
  if (batch && targets.length === 0) throw new BuildError(`no hay PDFs en ${labelPath(cwd, outputDir)}`);
  for (const pdf of targets) await assertExists(pdf, 'el PDF');
  return { visualOptions, explicitReference, outputDir, batch, targets };
}

/** Guarda los snapshots de `targets` y retira los de PDFs que ya no existen. */
async function updateSnapshots(cwd: string, targets: string[], outputDir: string): Promise<void> {
  const store = join(cwd, 'visual');
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
      logSuccess(`${labelPath(cwd, pdf)} ya es el snapshot`, 'test');
      continue;
    }
    await saveReference(pdf, snapshot);
    logSuccess(`${labelPath(cwd, pdf)} → ${labelPath(cwd, snapshot)}`, 'test');
  }
  // Un snapshot nuevo no hereda diffs de la corrida anterior.
  await clearDiffImages(store);
  if (removed.length > 0) logInfo(`snapshots sin PDF en ${labelPath(cwd, outputDir)}: ${removed.join(', ')}`, 'test');
}

/**
 * Sin snapshot no hay comparación posible: se corta antes de renderizar nada,
 * porque un resultado parcial esconde la regresión de los PDFs que sí entraron.
 */
async function assertSnapshots(cwd: string, targets: string[], outputDir: string, batch: boolean, explicitReference?: string): Promise<void> {
  if (explicitReference !== undefined) {
    await assertExists(explicitReference, 'el PDF de referencia');
    return;
  }
  const store = join(cwd, 'visual');
  const snapshots = new Set(await listPdfFiles(store));
  if (batch && snapshots.size === 0) {
    throw new BuildError(`no hay snapshots en ${labelPath(cwd, store)} · créalos con: iteraciones test visual --update`);
  }

  const wanted = new Set<string>();
  const missing: string[] = [];
  for (const pdf of targets) {
    const snapshot = referencePathFor(cwd, pdf, outputDir);
    if (snapshots.has(snapshot)) wanted.add(snapshot);
    else if (!batch) {
      throw new BuildError(`no hay snapshot en ${labelPath(cwd, snapshot)} · créalo con: iteraciones test visual ${labelPath(cwd, pdf)} --update`);
    } else missing.push(labelPath(cwd, snapshot));
  }
  if (missing.length > 0) {
    throw new BuildError(`snapshots incompletas · faltan: ${missing.join(', ')} · ejecuta: iteraciones test visual --update`);
  }

  // Un snapshot huérfano no rompe la corrida: es material sobrante, no una
  // regresión del build (y `--update` lo retira).
  if (!batch) return;
  const orphans = [...snapshots].filter((snapshot) => !wanted.has(snapshot)).map((snapshot) => labelPath(cwd, snapshot));
  if (orphans.length > 0) logWarning(`snapshots sin PDF en ${labelPath(cwd, outputDir)}: ${orphans.join(', ')}`, 'test');
}

/** Compara un PDF con su snapshot (o con `--reference`) y deja su diff. */
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
  const { dir, stem } = diffTargetFor(snapshot);
  // Lo que se ve en `visual/` es la última corrida: los diffs viejos se van
  // antes de comparar, también cuando la caché devuelve el PASS sin render.
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
  return { referenceLabel: explicitReference ?? labelPath(cwd, snapshot), result };
}

/**
 * Veredicto de un FAIL, línea a línea: manda a mirar las imágenes de
 * diferencia, no las rutas de los PDF —esas ya están en el bloque de arriba—.
 * Si no hay diffs, lo único que falló es la paginación y se dice con las dos
 * cifras; un FAIL sin líneas es imposible (o cambian píxeles o cambian páginas).
 */
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

/** Un PDF ya comparado, con la etiqueta de su snapshot. */
type Compared = { pdf: string; entry: { referenceLabel: string; result: VisualDiffResult } };

/** Líneas de un PDF dentro del resumen de varios: recuento y diffs. */
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
      'test',
    );
    return;
  }
  const head = `visual: ${compared.length} PDFs en ${labelPath(cwd, outputDir)} · ${options.dpi} dpi · umbral ${options.thresholdPercent} %`;
  logInfo(`${head} · fuzz ${options.fuzzPercent} %`, 'test');
  for (const { pdf, entry } of compared) logInfo(batchBlock(cwd, pdf, entry.result), 'test');
}

function reportVerdict(cwd: string, compared: Compared[]): void {
  const failed = compared.filter(({ entry }) => !entry.result.pass);
  if (failed.length > 0) {
    process.exitCode = 1;
    logError(failureSummary(cwd, compared, failed), 'test');
    return;
  }
  const single = compared.length === 1 ? compared[0] : undefined;
  if (single !== undefined) {
    logSuccess(
      `sin diferencias visuales en ${single.entry.result.compared} páginas${single.entry.result.fromCache === true ? ' · caché' : ''}`,
      'test',
    );
    return;
  }
  logSuccess(`sin diferencias visuales en ${compared.length} PDFs`, 'test');
}

async function compareAll(
  cwd: string,
  targets: string[],
  outputDir: string,
  visualOptions: VisualOptions,
  batch: boolean,
  explicitReference?: string,
): Promise<void> {
  await assertSnapshots(cwd, targets, outputDir, batch, explicitReference);

  const compared: Compared[] = [];
  for (const pdf of targets) {
    compared.push({ pdf, entry: await compareOne(cwd, pdf, outputDir, visualOptions, explicitReference) });
  }

  reportAll(cwd, outputDir, visualOptions, compared);
  reportVerdict(cwd, compared);
}

export async function runTestVisual(cwd: string, pdfs: string[], options: TestVisualOptions = {}): Promise<void> {
  try {
    const run = await resolveRun(cwd, pdfs, options);
    if (options.update === true) await updateSnapshots(cwd, run.targets, run.outputDir);
    else await compareAll(cwd, run.targets, run.outputDir, run.visualOptions, run.batch, run.explicitReference);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'test');
    process.exitCode = 1;
  }
}
