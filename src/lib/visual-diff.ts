import { createHash } from 'node:crypto';
import { copyFile, exists, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import slugifyLib from 'slugify';
import { BuildError } from './errors.js';
import { exec, mapWithConcurrency } from './run.js';

/**
 * #2479 — regresión visual de PDFs.
 *
 * Compara dos PDFs por lo que se ve, no por los bytes: `pdftoppm` renderiza
 * cada página a PNG (300 dpi por defecto, el de impresión) y `magick compare`
 * cuenta los píxeles distintos de cada par tras un blur proporcional al dpi y
 * un fuzz de tolerancia de color.
 *
 * Por qué blur + fuzz (medido en el issue y al implementar): los bordes con
 * anti-aliasing cambian en magnitud —un desplazamiento subpíxel invisible ya
 * mueve ~0.15 % de los píxeles—, así que el `fuzz` solo no los caza (0.1564 %
 * → 0.1557 % con fuzz 2 %) y `pixelmatch` no separa el cambio real del
 * invisible (0.1143 % real frente a 0.1982 % invisible). Con blur —1 px a
 * 150 dpi, 2 px a 300 dpi— y fuzz 15 %, sobre PDFs de LaTeX reales: cambio de
 * una palabra 0.0823 %, una línea centrada alargada 0.0486 %, margen movido
 * 1,44 pt 0.5352 %; invisibles: margen movido 0,1 pt 0.0002 %, reglas largas
 * desplazadas subpíxel 0.0000 %, dos builds seguidos de la misma fuente
 * 0.000000 %. El fuzz 15 % y no el 10 % del issue es lo que deja a cero los
 * bordes que el rasterizador recoloca (a 10 % daban 0.11-0.54 % → falso FAIL);
 * la contrapartida, cambios de color por canal por debajo del 15 %, no se ven.
 *
 * Artefactos: en PASS no queda nada (cada par se borra al compararlo y el
 * directorio de trabajo se elimina); en FAIL solo quedan los pares con diff y
 * sus imágenes de diferencia, y la ruta se reporta.
 */

export interface VisualOptions {
  /** Resolución de render en dpi. */
  dpi: number;
  /** % máximo de píxeles distintos por página antes de darla por modificada. */
  thresholdPercent: number;
  /** Tolerancia de color por canal en % que magick ignora antes del recuento. */
  fuzzPercent: number;
}

/**
 * Por defecto: 300 dpi (impresión), blur de 2 px y el ruido medido en 0. El
 * umbral de 0.005 % queda 25× sobre ese ruido —dos builds seguidos de la misma
 * fuente: 0.000000 %— y 10× por debajo del cambio de texto más pequeño medido
 * (0.0486 %, una línea centrada alargada). No alcanza los 0.05 % decididos en
 * el issue: con ellos esa misma línea de texto pasaba por invisible.
 */
export const VISUAL_DEFAULTS: VisualOptions = { dpi: 300, thresholdPercent: 0.005, fuzzPercent: 15 };

function parseOption(raw: string | undefined, fallback: number, flag: string, valid: (n: number) => boolean, hint: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !valid(value)) throw new BuildError(`${flag} inválido: "${raw}" (se espera ${hint})`);
  return value;
}

/** Normaliza `--dpi`, `--threshold` y `--fuzz` con sus valores por defecto. */
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

/** Sigma del blur en píxeles: mide lo mismo en superficie física (1 px = 150 dpi). */
export function blurSigmaFor(dpi: number): number {
  return dpi / 150;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Dimensiones de un PNG leído por IHDR: sin volver a invocar a magick. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

/** Número de página de los PNG que escribe pdftoppm (`ref-1`, `ref-01`, `ref-001`). */
function pageNumberOf(file: string): number {
  const match = /-(\d+)\.png$/.exec(file);
  return match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
}

/** Ordena por número de página (no alfabéticamente: 10 va después de 2). */
export function sortPageFiles(files: string[]): string[] {
  return [...files].sort((a, b) => pageNumberOf(a) - pageNumberOf(b));
}

/** Clave del documento: el nombre del PDF, para la referencia en `visual/<slug>.pdf`. */
export function visualSlug(pdfPath: string): string {
  const slug = slugifyLib(basename(pdfPath, extname(pdfPath)), { lower: true, strict: true });
  return slug === '' ? 'documento' : slug;
}

/** Referencia versionable del proyecto: `<raíz>/visual/<slug>.pdf`. */
export function referencePathFor(cwd: string, slug: string): string {
  return join(cwd, 'visual', `${slug}.pdf`);
}

export interface VisualWorkspaces {
  /** Donde se renderizan las páginas y viven los artefactos de un FAIL. */
  workDir: string;
  /** Caché de PASS: sobrevive al borrado del workDir. */
  cachePath: string;
}

/**
 * Directorio de trabajo: dentro del proyecto (`.iteraciones/tmp/visual/`) cuando
 * lo hay, y en el temporal del sistema cuando el comando corre suelto, que es
 * el caso «tengo un PDF y lo comparo»: sin proyecto no se escribe nada en el cwd.
 */
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
  /** Páginas comparadas (las comunes a los dos PDFs). */
  compared: number;
  unchanged: number;
  changed: number;
  details: PageDiff[];
  referencePages: number;
  generatedPages: number;
  pass: boolean;
  /** Carpeta que conserva los artefactos de las páginas con diferencias (FAIL). */
  diffDir?: string;
  /** El resultado salió de la caché de PASS: no se volvió a renderizar. */
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

/** Identidad de una corrida: mismos PDFs + mismos parámetros ⇒ mismo resultado. */
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

/** Escribe el PASS en caché, limitando el fichero a las últimas 50 corridas. */
async function writeCache(path: string, key: string, entry: CacheEntry): Promise<void> {
  try {
    const current = await readCache(path);
    current[key] = entry;
    const trimmed = Object.fromEntries(Object.entries(current).slice(-50));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  } catch {
    // la caché es optimización: si no se puede escribir, la siguiente corrida vuelve a comparar
  }
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

/** Difumina un PNG con el sigma indicado (blur previo al recuento). */
async function blurPage(source: string, target: string, sigma: number): Promise<void> {
  const blur = await exec('magick', [source, '-blur', `0x${sigma}`, target]);
  if (blur.exitCode !== 0) {
    throw new BuildError(`magick no pudo difuminar "${source}": ${blur.stderr.trim().split('\n').pop() ?? 'error desconocido'}`);
  }
}

/**
 * Compara dos PNG por píxeles: blur proporcional al dpi + fuzz, y escribe la
 * imagen de diferencia en `diffImage`. Devuelve el % de píxeles distintos.
 */
async function comparePngPair(referencePng: string, generatedPng: string, diffImage: string, options: VisualOptions): Promise<number> {
  const size = pngSize(await readFile(referencePng));
  if (size === null) throw new BuildError(`"${referencePng}" no es un PNG válido`);

  const sigma = blurSigmaFor(options.dpi);
  const blurBase = join(dirname(diffImage), `blur-${basename(diffImage)}`);
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
}

/** Renderiza los dos PDFs y compara sus páginas; PASS ⇒ sin artefactos. */
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
      const diffImage = join(input.workDir, `page-${String(page).padStart(3, '0')}-diff.png`);
      const diffPercent = await comparePngPair(referencePng, generatedPng, diffImage, options);
      if (diffPercent <= options.thresholdPercent) {
        await Promise.all([forceUnlink(referencePng), forceUnlink(generatedPng), forceUnlink(diffImage)]);
        return;
      }
      await rename(referencePng, join(input.workDir, `page-${String(page).padStart(3, '0')}-ref.png`));
      await rename(generatedPng, join(input.workDir, `page-${String(page).padStart(3, '0')}-gen.png`));
      details.push({ page, diffPercent, diffImage });
    },
  );

  // Lo que quedó sin comparar (PDFs con nº de páginas distinto) es intermedio.
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
    // Solo hay artefactos que conservar si alguna página cambió: con un nº de
    // páginas distinto el directorio queda vacío y no sirve para inspeccionar.
    ...(changed > 0 ? { diffDir: input.workDir } : {}),
  };

  if (changed === 0) await rm(input.workDir, { recursive: true, force: true });
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

/** Guarda el PDF generado como referencia versionable del proyecto. */
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

/** Resumen de corrida: páginas comparadas, sin cambios, modificadas y sus diffs. */
export function formatVisualReport(report: VisualReport): string {
  const { result, options, referenceLabel, generatedLabel } = report;
  const lines = [
    `visual: ${generatedLabel} vs ${referenceLabel} · ${options.dpi} dpi · umbral ${options.thresholdPercent} % · fuzz ${options.fuzzPercent} %`,
    `páginas ${result.compared} · sin cambios ${result.unchanged} · modificadas ${result.changed}`,
  ];
  if (result.referencePages !== result.generatedPages) {
    lines.push(`páginas distintas: referencia ${result.referencePages} · generado ${result.generatedPages}`);
  }
  for (const detail of result.details) {
    lines.push(`  pág ${detail.page}  ${detail.diffPercent.toFixed(4)} %  ${detail.diffImage}`);
  }
  return lines.join('\n');
}
