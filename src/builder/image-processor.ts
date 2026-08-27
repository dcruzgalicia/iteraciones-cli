/**
 * Preprocesamiento de imágenes para LaTeX/PDF con ImageMagick (v7).
 *
 * Convierte todas las imágenes (endpapers, title-image, publishers-image,
 * inline, campos multilinea de portada) a escala de grises 300dpi JPG
 * antes de pasarlas a pandoc. Esto produce imágenes monocromáticas
 * (1 canal K) para impresión a una sola tinta y elimina el overflow de
 * imagen en los metadatos del PDF.
 *
 * Si ImageMagick no está disponible, se usa la imagen original (fallback
 * silencioso — no rompe el build).
 */
import { mkdir } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { exec, ProcessSpawnError, ProcessTimeoutError } from '../lib/run.js';

/** Conversión mm → px a 300 DPI: 300px / 25.4mm ≈ 11.811. */
const MM_TO_PX_300DPI = 300 / 25.4;

/** Flag memoizado de ImageMagick v7. null = no verificado. */
let magickAvailable: boolean | null = null;

/** Tiempo máximo de una conversión ImageMagick (imágenes de libros: segundos, no minutos). */
const MAGICK_TIMEOUT_MS = 120_000;

/**
 * Detecta si ImageMagick v7 (`magick`) está disponible en el PATH.
 * Memoizado por proceso.
 */
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

/** Warning ya emitido por ausencia de magick en este proceso (#2040): uno solo por build. */
let warnedMissingMagick = false;

/** Resetear cache y avisos (para tests). */
export function resetMagickCache(): void {
  magickAvailable = null;
  warnedMissingMagick = false;
}

/** Dimensiones de página y caja de texto en mm. */
export interface PageDimensions {
  w: number;
  h: number;
  textW: number;
}

function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX_300DPI);
}

/** Nombre de salida para imagen procesada (sin extensión, para evitar colisiones). */
function processedName(filePath: string): string {
  const name = basename(filePath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Procesa una imagen con ImageMagick: escala de grises, 300dpi, 100% calidad JPG.
 * Para SVGs, -density va antes del input para rasterizar a la resolución correcta.
 * @param cover Si true, resize fill + center-crop (endpapers). Si false, resize fit.
 * @returns Ruta de la imagen procesada, o la original si falló.
 */
export async function processImage(inputPath: string, targetWmm: number, targetHmm: number, cover: boolean, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const outName = `${processedName(inputPath)}.jpg`;
  const outPath = join(outputDir, outName);

  const targetW = mmToPx(targetWmm);
  const targetH = mmToPx(targetHmm);

  // cover: resize fill (Rellena el target manteniendo proporción) + center-crop
  // fit: resize fit (Cabe dentro del target manteniendo proporción, SIN agrandar)
  // Si targetH es 0, solo usar ancho (preservar proporción)
  // El sufijo > previene upscaling: imágenes más pequeñas que el target se mantienen
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

  // Para SVGs: -density ANTES del input para rasterizar a 300dpi
  if (isSvg) {
    args.push('-density', '300', '-units', 'PixelsPerInch');
  }

  args.push(inputPath, '-resize', resizeArg);

  if (cover) {
    // Center-crop a dimensiones exactas después del resize fill
    args.push('-gravity', 'center', '-extent', `${targetW}x${targetH}`);
  }

  // Siempre establecer densidad de salida a 300dpi
  args.push('-density', '300', '-units', 'PixelsPerInch');
  args.push('-colorspace', 'Gray', '-quality', '100', '-background', 'white', '-flatten', outPath);

  // exec() añade timeout con kill de árbol (#2169): un magick colgado
  // (imágenes gigantes, delegados externos) no cuelga el build para siempre.
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

/** Patrón para imágenes inline: ![alt](path) con attributes opcionales */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?/g;

/** Conversión pt → mm: 1pt = 0.352778mm. */
const PT_TO_MM = 0.352778;

/** Conversión px → mm a 96 DPI (screen): 1px = 25.4/96 mm. */
const PX_TO_MM_96DPI = 25.4 / 96;

/**
 * Parsea el valor de width de attributes markdown (e.g., {width=15pt}).
 * @param attrs string de attributes como "{width=15pt}" o undefined
 * @param pageWidthmm ancho de página en mm (para porcentajes)
 * @returns ancho en mm, o undefined si no se pudo parsear
 */
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

/** Campos multilinea de portada que pueden contener imágenes. */
const MULTILINE_IMAGE_FIELDS = ['lowertitleback', 'uppertitleback', 'dedication', 'extratitle', 'frontispiece', 'titlehead', 'colophon'];

/**
 * Escanea un markdown y retorna las rutas de imágenes inline (relativas, no URLs).
 * Lanza BuildError si una imagen referenciada no existe.
 */
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

/** Texto escaneable de un campo: string directo o bloque YAML (array de líneas). */
function fieldText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.join('\n');
  return undefined;
}

/**
 * Recorre las imágenes de un campo, valida su existencia y reglas SVG,
 * y añade los resultados tipados. Mensajes de BuildError idénticos al
 * comportamiento previo (la RUTA resuelta apunta al archivo real).
 */
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

    // Validar que la imagen exista
    if (!(await Bun.file(abs).exists())) {
      throw new BuildError(`imagen no encontrada en "${field}": "${abs}" (resuelto desde "${imgPath}")`);
    }

    // Validar que SVGs tengan width especificado
    if (isSvg && !attrs?.includes('width')) {
      throw new BuildError(`imagen SVG en "${field}" requiere {width=...}: "${imgPath}"`);
    }

    results.push({ absPath: abs, isSvg, attrs, widthMm: parseWidthMm(attrs, pageWidthmm) });
  }
}

/**
 * Escanea campos multilinea de portada y retorna las rutas de imágenes
 * encontradas (relativas, no URLs). Valida que:
 * - La imagen exista en disco (BuildError si no)
 * - Los SVGs tengan {width=...} especificado (BuildError si no)
 */
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

/**
 * Preprocesa un markdown: reemplaza rutas de imágenes inline con versiones procesadas.
 * El imageMap tiene claves absolutas; el markdown tiene rutas relativas.
 * Para cada par (absolute → processed), busca la ruta relativa original en el
 * contenido y la reemplaza con la ruta absoluta procesada.
 */
/**
 * Reescribe las rutas de las imágenes procesadas en el contenido. Solo se
 * tocan los DOS contextos donde las imágenes del imageMap aparecen
 * legítimamente:
 *   1. objetivo de imagen/enlace markdown `](ruta)` (scanInlineImages);
 *   2. valor de los campos de portada `title-image|publishers-image|endpapers`
 *      (scanTitlePageFieldImages), bare o entre comillas.
 * El replaceAll por substring anterior reescribía cualquier aparición de la
 * ruta en el documento — `img.png` dentro de `img.png.bak`, de un bloque de
 * código o de una URL — corrompiendo el markdown en silencio (#2170).
 */
export function rewriteImagePaths(content: string, imageMap: Map<string, string>, docDir: string): string {
  if (imageMap.size === 0) return content;
  let result = content;
  for (const [absoluteOriginal, processed] of imageMap) {
    if (processed === absoluteOriginal) continue;
    // Candidatos de ruta relativa: relative() no asume que docDir es prefijo
    // exacto (imágenes fuera del directorio del documento → '../...');
    // se incluyen la variante './' y la absoluta por compatibilidad de formas.
    const rel = relative(docDir, absoluteOriginal);
    const candidates = [rel, `./${rel}`, absoluteOriginal];
    for (const candidate of candidates) {
      if (candidate === '') continue;
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 1. Objetivo de imagen/enlace markdown
      result = result.replace(new RegExp(`\\]\\(${escaped}\\)`, 'g'), () => `](${processed})`);
      // 2. Campo de portada, preservando comillas si las hubiera
      result = result.replace(
        new RegExp(`^((?:title-image|publishers-image|endpapers):[ \\t]*)(["']?)${escaped}(["']?[ \\t]*)$`, 'gm'),
        (_m, pre: string, openQuote: string, closeQuote: string) => `${pre}${openQuote}${processed}${closeQuote}`,
      );
    }
  }
  return result;
}

/** Dimensiones objetivo (mm) derivadas de la página y el crop (#1975). */
interface ProcessTargets {
  /** Caja de texto (+6 bleed si cropActive). */
  targetW: number;
  targetH: number;
  /** Página completa (+6 bleed si cropActive) — endpapers. */
  endpaperW: number;
  endpaperH: number;
}

/** Cálculo puro de dimensiones objetivo: testeable sin ImageMagick. */
export function computeProcessTargets(pageDims: PageDimensions, cropActive: boolean): ProcessTargets {
  return {
    targetW: pageDims.textW + (cropActive ? 6 : 0),
    targetH: pageDims.h + (cropActive ? 6 : 0),
    endpaperW: pageDims.w + (cropActive ? 6 : 0),
    endpaperH: pageDims.h + (cropActive ? 6 : 0),
  };
}

/** Registro único de una imagen procesada (processedFiles solo con cambios reales). */
function recordProcessed(imageMap: Map<string, string>, processedFiles: string[], absPath: string, processed: string): void {
  imageMap.set(absPath, processed);
  if (processed !== absPath) processedFiles.push(processed);
}

/** Valor string recortado de un campo frontmatter (undefined si vacío/otro tipo). */
function trimmedStringValue(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

/** 1. Imágenes de frontmatter dedicadas (title-image, publishers-image, endpapers). */
async function processDedicatedFrontmatterImages(
  fm: Record<string, unknown>,
  docDir: string,
  targets: ProcessTargets,
  outputDir: string,
  imageMap: Map<string, string>,
  processedFiles: string[],
): Promise<void> {
  for (const field of ['title-image', 'publishers-image', 'endpapers']) {
    const value = trimmedStringValue(fm[field]);
    if (!value) continue;

    const absPath = isAbsolute(value) ? value : resolve(docDir, value);
    if (!(await Bun.file(absPath).exists())) continue;
    if (imageMap.has(absPath)) continue;

    const cover = field === 'endpapers';
    // Endpapers: página completa; otros: caja de texto
    const processed = await processImage(
      absPath,
      cover ? targets.endpaperW : targets.targetW,
      cover ? targets.endpaperH : targets.targetH,
      cover,
      outputDir,
    );
    recordProcessed(imageMap, processedFiles, absPath, processed);
  }
}

/**
 * 1.5. Imágenes de campos multilinea de portada: si tienen width, se usa solo
 * el ancho preservando proporción (targetH 0, no se fuerza cuadrado).
 */
async function processMultilineCoverImages(
  multilineImages: { absPath: string; isSvg: boolean; attrs?: string; widthMm?: number }[],
  targets: ProcessTargets,
  outputDir: string,
  imageMap: Map<string, string>,
  processedFiles: string[],
): Promise<void> {
  for (const img of multilineImages) {
    if (imageMap.has(img.absPath)) continue;

    const imgTargetW = img.widthMm ?? targets.targetW;
    // Semántica preservada del original: widthMm truthy (incluye 0 como
    // "sin width efectivo" tras parsear {width=0}).
    const imgTargetH = img.widthMm ? 0 : targets.targetH;
    const processed = await processImage(img.absPath, imgTargetW, imgTargetH, false, outputDir);
    recordProcessed(imageMap, processedFiles, img.absPath, processed);
  }
}

/** 2. Imágenes inline del markdown. */
async function processInlineImages(
  inlineImages: string[],
  targets: ProcessTargets,
  outputDir: string,
  imageMap: Map<string, string>,
  processedFiles: string[],
): Promise<void> {
  for (const absPath of inlineImages) {
    if (imageMap.has(absPath)) continue;
    const processed = await processImage(absPath, targets.targetW, targets.targetH, false, outputDir);
    recordProcessed(imageMap, processedFiles, absPath, processed);
  }
}

/** Aviso único por build si magick falta; correlación explícita con PDF/X (#2040). */
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

/**
 * Procesa todas las imágenes de un documento para LaTeX/PDF.
 *
 * @param inlineImages Rutas absolutas de imágenes inline del markdown.
 * @param fm frontmatter (para extraer title-image, publishers-image, endpapers, campos multilinea)
 * @param docDir Directorio del documento.
 * @param pageDims Dimensiones de página en mm.
 * @param cropActive Si true, endpapers usa +6mm.
 * @param outputDir Directorio de salida para imágenes procesadas.
 * @param multilineImages Imágenes de campos multilinea de portada (scanTitlePageFieldImages).
 * @returns Mapa de ruta original → ruta procesada, y lista de archivos generados.
 */
export async function processDocumentImages(
  inlineImages: string[],
  fm: Record<string, unknown>,
  docDir: string,
  pageDims: PageDimensions,
  cropActive: boolean,
  outputDir: string,
  multilineImages?: { absPath: string; isSvg: boolean; attrs?: string; widthMm?: number }[],
  /** 99-pdfx activo: sin magick, las imágenes pueden fallar la certificación (#2040). */
  pdfxActive = false,
  /** Inyectable para tests. */
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
