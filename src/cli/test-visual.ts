import { exists } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { BuildError } from '../lib/errors.js';
import { logError, logInfo, logSuccess } from '../lib/logger.js';
import { resolvePath } from '../lib/paths.js';
import type { VisualDiffResult, VisualOptions } from '../lib/visual-diff.js';
import {
  compareVisual,
  formatVisualReport,
  referencePathFor,
  resolveVisualOptions,
  resolveVisualWorkspaces,
  saveReference,
  visualSlug,
} from '../lib/visual-diff.js';

/**
 * #2479 — `iteraciones test visual <pdf>`: regresión visual de un PDF.
 *
 * Tres usos, sin proyecto también:
 * - `--update` crea o actualiza la referencia en `<raíz>/visual/<slug>.pdf`,
 *   que va versionada en git;
 * - sin flags compara contra esa referencia y termina con exit 1 si hay diff;
 * - `--reference <pdf>` compara contra el PDF que se le pase, sin tocar la
 *   referencia guardada.
 *
 * El resumen siempre trae páginas comparadas, sin cambios, modificadas, el % de
 * píxeles distintos por página y la ruta de sus imágenes de diferencia.
 */
export interface TestVisualOptions {
  reference?: string;
  update?: boolean;
  dpi?: string;
  threshold?: string;
  fuzz?: string;
}

/** Ruta etiqueta: relativa a la raíz cuando vive dentro, absoluta si se sale. */
function labelPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

async function assertExists(path: string, article: string): Promise<void> {
  if (!(await exists(path))) throw new BuildError(`no existe ${article} "${path}"`);
}

async function updateReference(cwd: string, pdf: string, generated: string, store: string, options: TestVisualOptions): Promise<void> {
  if (options.reference !== undefined && options.reference !== '') {
    throw new BuildError('--update y --reference son incompatibles: --update guarda el PDF generado como referencia');
  }
  await saveReference(generated, store);
  logSuccess(generated === store ? `${labelPath(cwd, store)} ya es la referencia` : `${pdf} → ${labelPath(cwd, store)}`, 'test');
}

function reportVerdict(result: VisualDiffResult): void {
  if (result.pass) {
    logSuccess(`sin diferencias visuales en ${result.compared} páginas${result.fromCache === true ? ' · caché' : ''}`, 'test');
    return;
  }
  const reasons: string[] = [];
  if (result.changed > 0) reasons.push(`${result.changed} de ${result.compared} páginas con diferencias visuales`);
  if (result.referencePages !== result.generatedPages) {
    reasons.push(`el número de páginas cambió: referencia ${result.referencePages} · generado ${result.generatedPages}`);
  }
  if (result.diffDir !== undefined) reasons.push(`artefactos en ${result.diffDir}`);
  logError(reasons.join(' · '), 'test');
  process.exitCode = 1;
}

async function compareWithReference(
  cwd: string,
  pdf: string,
  generated: string,
  store: string,
  options: TestVisualOptions,
  visualOptions: VisualOptions,
): Promise<void> {
  const explicit = options.reference !== undefined && options.reference !== '' ? options.reference : undefined;
  const reference = explicit !== undefined ? resolvePath(cwd, explicit) : store;
  if (!(await exists(reference))) {
    throw explicit !== undefined
      ? new BuildError(`no existe el PDF de referencia "${reference}"`)
      : new BuildError(`no hay referencia en ${labelPath(cwd, store)} · créala con: iteraciones test visual ${pdf} --update`);
  }
  if (explicit !== undefined && reference === generated) {
    throw new BuildError('el PDF y la referencia son el mismo archivo: no hay nada que comparar');
  }

  const { workDir, cachePath } = await resolveVisualWorkspaces(cwd, visualSlug(generated));
  const result = await compareVisual({ ...visualOptions, reference, generated, workDir, cachePath });
  logInfo(
    formatVisualReport({
      result,
      options: visualOptions,
      referenceLabel: explicit ?? labelPath(cwd, store),
      generatedLabel: pdf,
    }),
    'test',
  );
  reportVerdict(result);
}

export async function runTestVisual(cwd: string, pdf: string, options: TestVisualOptions = {}): Promise<void> {
  try {
    const visualOptions: VisualOptions = resolveVisualOptions(options);
    const generated = resolvePath(cwd, pdf);
    await assertExists(generated, 'el PDF');
    const store = referencePathFor(cwd, visualSlug(generated));

    if (options.update === true) {
      await updateReference(cwd, pdf, generated, store, options);
      return;
    }
    await compareWithReference(cwd, pdf, generated, store, options, visualOptions);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err), 'test');
    process.exitCode = 1;
  }
}
