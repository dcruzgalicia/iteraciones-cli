import { exists, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DIST_FILES_DIR } from '../builder/output-layout.js';
import { BuildError } from '../lib/errors.js';
import { fail, logError, logInfo, logSuccess, logWarning } from '../lib/logger.js';
import { isDir, posix, relativeLabel } from '../lib/paths.js';
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
  siteMapOnly?: boolean;
}

export type SnapshotsMode = 'save' | 'check';

interface SnapshotRun {
  outputDir: string;
  batch: boolean;
  targets: string[];
  explicitReference?: string;
  siteMapOnly: boolean;
}

type Compared = { pdf: string; entry: { referenceLabel: string; result: VisualDiffResult } };

const SITE_MAP_FILE = 'site-map.txt';

function siteMapPath(cwd: string): string {
  return join(cwd, SNAPSHOTS_DIR, SITE_MAP_FILE);
}

async function listHtmlRoutes(outputDir: string): Promise<string[]> {
  if (!(await isDir(outputDir))) return [];
  const routes: string[] = [];
  for await (const rel of new Bun.Glob('**/*.html').scan({ cwd: outputDir, onlyFiles: true })) {
    routes.push(posix(rel));
  }
  return routes.sort();
}

function siteMapText(routes: string[]): string {
  return `${routes.join('\n')}\n`;
}

async function saveSiteMap(cwd: string, outputDir: string): Promise<void> {
  const routes = await listHtmlRoutes(outputDir);
  const file = siteMapPath(cwd);
  if (routes.length === 0) {
    await rm(file, { force: true });
    logInfo(`no hay HTML en ${relativeLabel(cwd, outputDir)}: no se escribe ${SNAPSHOTS_DIR}/${SITE_MAP_FILE}`, 'snapshots');
    return;
  }
  await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true });
  await Bun.write(file, siteMapText(routes));
  logSuccess(`mapa del sitio → ${SNAPSHOTS_DIR}/${SITE_MAP_FILE} (${plural(routes.length, 'ruta')})`, 'snapshots');
}

async function checkSiteMap(cwd: string, outputDir: string): Promise<void> {
  const routes = await listHtmlRoutes(outputDir);
  const file = siteMapPath(cwd);
  if (!(await exists(file))) {
    if (routes.length === 0) return;
    process.exitCode = 1;
    logError(
      `falta ${SNAPSHOTS_DIR}/${SITE_MAP_FILE} y hay ${plural(routes.length, 'ruta')} HTML en ${relativeLabel(cwd, outputDir)} · crea la línea base con: iteraciones snapshots save --site-map-only`,
      'snapshots',
    );
    return;
  }
  const guardadas = (await Bun.file(file).text())
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean);
  const actuales = new Set(routes);
  const anteriores = new Set(guardadas);
  const agregadas = routes.filter((ruta) => !anteriores.has(ruta));
  const eliminadas = guardadas.filter((ruta) => !actuales.has(ruta));
  if (agregadas.length === 0 && eliminadas.length === 0) {
    logSuccess(`mapa del sitio sin cambios (${plural(routes.length, 'ruta')})`, 'snapshots');
    return;
  }
  process.exitCode = 1;
  logError(
    `mapa del sitio: ${plural(agregadas.length, 'ruta nueva', 'rutas nuevas')} · ${plural(eliminadas.length, 'ruta eliminada', 'rutas eliminadas')}`,
    'snapshots',
  );
  for (const ruta of agregadas) logInfo(`+ ${ruta}`, 'snapshots');
  for (const ruta of eliminadas) logInfo(`- ${ruta}`, 'snapshots');
}

async function assertEsPdf(path: string): Promise<void> {
  const cabecera = await Bun.file(path)
    .slice(0, 1024)
    .text()
    .catch(() => null);
  if (cabecera === null) throw new BuildError(`no existe el PDF "${path}"`);
  if (!cabecera.includes('%PDF-')) {
    throw new BuildError(`"${path}" no es un PDF: su contenido no empieza por %PDF-`);
  }
}

function assertPathCount(save: boolean, paths: string[], cwd: string): void {
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
      `check necesita dos rutas: el PDF y contra qué compararlo · "${relativeLabel(cwd, paths[0] as string)}" a secas no dice contra qué snapshot va.\nPara un documento usa: iteraciones snapshots check (sin rutas, compara ${SNAPSHOTS_DIR} contra la salida)\nPara un par: iteraciones snapshots check <pdf> <referencia>`,
    );
  }
}

function assertSiteMapOnly(save: boolean, siteMapOnly: boolean, paths: string[]): void {
  if (!siteMapOnly) return;
  if (!save) throw new BuildError('--site-map-only sólo aplica a snapshots save');
  if (paths.length > 0) throw new BuildError('--site-map-only no admite rutas: escribe el mapa de toda la salida');
}

async function resolveRun(cwd: string, paths: string[], mode: SnapshotsMode, options: SnapshotsOptions): Promise<SnapshotRun> {
  const save = mode === 'save';
  const siteMapOnly = options.siteMapOnly === true;
  assertSiteMapOnly(save, siteMapOnly, paths);
  assertPathCount(save, paths, cwd);

  const outputDir = resolve(cwd, options.output ?? DIST_FILES_DIR);
  const [pdf, reference] = paths;
  const batch = pdf === undefined;
  const explicitReference = reference === undefined ? undefined : resolve(cwd, reference);
  const targets = siteMapOnly ? [] : batch ? await listPdfFiles(outputDir) : [resolve(cwd, pdf)];
  if (batch && targets.length === 0 && !siteMapOnly && (await listHtmlRoutes(outputDir)).length === 0) {
    throw new BuildError(`no hay PDFs en ${relativeLabel(cwd, outputDir)}`);
  }
  for (const target of targets) await assertEsPdf(target);
  if (explicitReference !== undefined) await assertEsPdf(explicitReference);
  return { outputDir, batch, targets, explicitReference, siteMapOnly };
}

async function saveSnapshots(cwd: string, run: SnapshotRun): Promise<void> {
  const { targets, outputDir, batch } = run;
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
    logSuccess(`${relativeLabel(cwd, pdf)} → ${SNAPSHOTS_DIR}/${stem} (${plural(paginas.length, 'página')})`, 'snapshots');
  }

  await clearDiffImages(join(cwd, DIFF_DIR));
  if (retirados.length > 0) {
    logInfo(`${plural(retirados.length, 'snapshot retirado')} sin PDF en ${relativeLabel(cwd, outputDir)}: ${retirados.join(', ')}`, 'snapshots');
  }
  logSuccess(`${plural(guardados, 'página')} en la línea base`, 'snapshots');
  if (batch) await saveSiteMap(cwd, outputDir);
}

async function seleccionaComparables(
  cwd: string,
  targets: string[],
  outputDir: string,
  batch: boolean,
  explicitReference?: string,
): Promise<string[]> {
  if (explicitReference !== undefined) return targets;
  const store = join(cwd, SNAPSHOTS_DIR);
  const guardados = await listSnapshotImages(store);

  const agregados: string[] = [];
  for (const pdf of targets) {
    if (!guardados.has(snapshotStemFor(pdf, outputDir))) agregados.push(relativeLabel(cwd, pdf));
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
  return { referenceLabel: explicitReference === undefined ? `${SNAPSHOTS_DIR}/${stem}` : relativeLabel(cwd, explicitReference), result };
}

function failureSummary(cwd: string, compared: Compared[], failed: Compared[]): string {
  const lines: string[] = [];
  const diffs = failed.flatMap(({ entry }) => entry.result.details.map((detail) => relativeLabel(cwd, detail.diffImage)));
  if (diffs.length > 0) {
    const images = diffs.length === 1 ? '1 imagen de diferencia' : `${diffs.length} imágenes de diferencia`;
    lines.push(compared.length > 1 ? `${failed.length} de ${compared.length} PDFs con regresión visual · ${images}:` : `${images}:`);
    lines.push(...diffs.map((diff) => `  ${diff}`));
  }
  for (const { pdf, entry } of failed) {
    const { referencePages, generatedPages } = entry.result;
    if (referencePages !== generatedPages) {
      lines.push(`el número de páginas cambió en ${relativeLabel(cwd, pdf)}: referencia ${referencePages} · generado ${generatedPages}`);
    }
  }
  return lines.join('\n');
}

function batchBlock(cwd: string, pdf: string, result: VisualDiffResult): string {
  const [first = '', ...rest] = formatVisualSummary(result, (path) => relativeLabel(cwd, path));
  return [`${relativeLabel(cwd, pdf)} · ${first}`, ...rest].join('\n');
}

function reportAll(cwd: string, compared: Compared[]): void {
  const single = compared.length === 1 ? compared[0] : undefined;
  if (single !== undefined) {
    const { referenceLabel, result } = single.entry;
    logInfo(
      formatVisualReport({ result, referenceLabel, generatedLabel: relativeLabel(cwd, single.pdf) }, (path) => relativeLabel(cwd, path)),
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
  if (run.batch) await checkSiteMap(cwd, run.outputDir);
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
    if (mode === 'save') {
      if (run.siteMapOnly) await saveSiteMap(cwd, run.outputDir);
      else await saveSnapshots(cwd, run);
    } else {
      await checkAll(cwd, run);
    }
  } catch (err) {
    fail('snapshots', err);
  }
}
