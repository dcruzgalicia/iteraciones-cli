/**
 * Preprocesamiento de imágenes para LaTeX/PDF con ImageMagick (v7).
 *
 * Convierte todas las imágenes (endpapers, title-image, publishers-image,
 * inline) a escala de grises 300dpi JPG antes de pasarlas a pandoc.
 * Esto produce imágenes monocromáticas (1 canal K) para impresión a
 * una sola tinta y elimina el overflow de imagen en los metadatos del PDF.
 *
 * Si ImageMagick no está disponible, se usa la imagen original (fallback
 * silencioso — no rompe el build).
 */
import { mkdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { logWarning } from '../lib/logger.js';

/** Conversión mm → px a 300 DPI: 300px / 25.4mm ≈ 11.811. */
const MM_TO_PX_300DPI = 300 / 25.4;

/** Flag memoizado de ImageMagick v7. null = no verificado. */
let magickAvailable: boolean | null = null;

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

/** Resetear cache (para tests). */
export function resetMagickCache(): void {
  magickAvailable = null;
}

/** Dimensiones de página en mm. */
export interface PageDimensions {
  w: number;
  h: number;
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
  // fit: resize fit (Cabe dentro del target manteniendo proporción)
  const resizeArg = cover ? `${targetW}x${targetH}^` : `${targetW}x${targetH}`;

  const args = ['magick', inputPath, '-resize', resizeArg];

  if (cover) {
    // Center-crop a dimensiones exactas después del resize fill
    args.push('-gravity', 'center', '-extent', `${targetW}x${targetH}`);
  }

  args.push('-colorspace', 'Gray', '-density', '300', '-units', 'PixelsPerInch', '-quality', '100', '-background', 'white', '-flatten', outPath);

  const proc = Bun.spawn(args, { stdout: 'ignore', stderr: 'pipe' });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    logWarning(`ImageMagick falló al procesar "${basename(inputPath)}": ${stderr.trim()}`, 'images');
    return inputPath;
  }

  return outPath;
}

/** Patrón para imágenes inline: ![alt](path) */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Escanea un markdown y retorna las rutas de imágenes inline (relativas, no URLs).
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

/**
 * Preprocesa un markdown: reemplaza rutas de imágenes inline con versiones procesadas.
 * El imageMap tiene claves absolutas; el markdown tiene rutas relativas.
 * Para cada par (absolute → processed), busca la ruta relativa original en el
 * contenido y la reemplaza con la ruta absoluta procesada.
 */
export function rewriteImagePaths(content: string, imageMap: Map<string, string>, docDir: string): string {
  let result = content;
  for (const [absoluteOriginal, processed] of imageMap) {
    // Calcular la ruta relativa que aparece en el markdown
    const relPath = absoluteOriginal.startsWith(docDir + '/') ? absoluteOriginal.slice(docDir.length + 1) : absoluteOriginal;
    // Reemplazar ruta relativa con la ruta absoluta de la imagen procesada
    result = result.replaceAll(relPath, processed);
  }
  return result;
}

/**
 * Procesa todas las imágenes de un documento para LaTeX/PDF.
 *
 * @param inlineImages Rutas absolutas de imágenes inline del markdown.
 * @param fm frontmatter (para extraer title-image, publishers-image, endpapers)
 * @param docDir Directorio del documento.
 * @param pageDims Dimensiones de página en mm.
 * @param cropActive Si true, endpapers usa +6mm.
 * @param outputDir Directorio de salida para imágenes procesadas.
 * @returns Mapa de ruta original → ruta procesada, y lista de archivos generados.
 */
export async function processDocumentImages(
  inlineImages: string[],
  fm: Record<string, unknown>,
  docDir: string,
  pageDims: PageDimensions,
  cropActive: boolean,
  outputDir: string,
): Promise<{ imageMap: Map<string, string>; processedFiles: string[] }> {
  if (!(await detectMagick())) {
    return { imageMap: new Map(), processedFiles: [] };
  }

  const imageMap = new Map<string, string>();
  const processedFiles: string[] = [];
  const targetW = pageDims.w + (cropActive ? 6 : 0);
  const targetH = pageDims.h + (cropActive ? 6 : 0);

  // 1. Imágenes de frontmatter
  for (const field of ['title-image', 'publishers-image', 'endpapers']) {
    const value = typeof fm[field] === 'string' && (fm[field] as string).trim() ? (fm[field] as string).trim() : undefined;
    if (!value) continue;

    const absPath = isAbsolute(value) ? value : resolve(docDir, value);
    if (!(await Bun.file(absPath).exists())) continue;
    if (imageMap.has(absPath)) continue;

    const cover = field === 'endpapers';
    const processed = await processImage(absPath, targetW, targetH, cover, outputDir);
    imageMap.set(absPath, processed);
    if (processed !== absPath) processedFiles.push(processed);
  }

  // 2. Imágenes inline del markdown
  for (const absPath of inlineImages) {
    if (imageMap.has(absPath)) continue;
    if (!(await Bun.file(absPath).exists())) continue;

    const processed = await processImage(absPath, targetW, targetH, false, outputDir);
    imageMap.set(absPath, processed);
    if (processed !== absPath) processedFiles.push(processed);
  }

  return { imageMap, processedFiles };
}
