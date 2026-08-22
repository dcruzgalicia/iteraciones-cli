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
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { BuildError } from '../lib/errors.js';
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
  const args = ['magick'];

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

  const proc = Bun.spawn(args, { stdout: 'ignore', stderr: 'pipe' });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    logWarning(`ImageMagick falló al procesar "${basename(inputPath)}": ${stderr.trim()}`, 'images');
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
export function parseWidthMm(attrs: string | undefined, pageWidthmm: number): number | undefined {
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
    const raw = fm[field];
    if (raw === undefined || raw === null) continue;

    // Convertir a string: string directo o bloque YAML
    let text: string;
    if (typeof raw === 'string') {
      text = raw;
    } else if (Array.isArray(raw)) {
      // Bloque YAML multilinea: array de líneas
      text = raw.join('\n');
    } else {
      continue;
    }

    // Escanear imágenes en el contenido markdown
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
      if (isSvg && (!attrs || !attrs.includes('width'))) {
        throw new BuildError(`imagen SVG en "${field}" requiere {width=...}: "${imgPath}"`);
      }

      const widthMm = parseWidthMm(attrs, pageWidthmm);
      results.push({ absPath: abs, isSvg, attrs, widthMm });
    }
  }

  return results;
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
 * Reescribe rutas de imágenes en el valor de un campo multilinea de portada.
 * Busca todas las imágenes `![alt](path)` y reemplaza rutas relativas con
 * rutas absolutas procesadas del imageMap.
 */
export function rewriteMultilineFieldValue(value: string | string[], imageMap: Map<string, string>, docDir: string): string | string[] {
  const text = Array.isArray(value) ? value.join('\n') : value;
  const rewritten = rewriteImagePaths(text, imageMap, docDir);
  return Array.isArray(value) ? rewritten.split('\n') : rewritten;
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
): Promise<{ imageMap: Map<string, string>; processedFiles: string[] }> {
  if (!(await detectMagick())) {
    return { imageMap: new Map(), processedFiles: [] };
  }

  const imageMap = new Map<string, string>();
  const processedFiles: string[] = [];
  const targetW = pageDims.textW + (cropActive ? 6 : 0);
  const targetH = pageDims.h + (cropActive ? 6 : 0);
  // Endpapers siempre usa dimensiones de página completa (no caja de texto)
  const endpaperW = pageDims.w + (cropActive ? 6 : 0);
  const endpaperH = pageDims.h + (cropActive ? 6 : 0);

  // 1. Imágenes de frontmatter dedicadas
  for (const field of ['title-image', 'publishers-image', 'endpapers']) {
    const value = typeof fm[field] === 'string' && (fm[field] as string).trim() ? (fm[field] as string).trim() : undefined;
    if (!value) continue;

    const absPath = isAbsolute(value) ? value : resolve(docDir, value);
    if (!(await Bun.file(absPath).exists())) continue;
    if (imageMap.has(absPath)) continue;

    const cover = field === 'endpapers';
    // Endpapers: página completa; otros: caja de texto
    const fieldW = cover ? endpaperW : targetW;
    const fieldH = cover ? endpaperH : targetH;
    const processed = await processImage(absPath, fieldW, fieldH, cover, outputDir);
    imageMap.set(absPath, processed);
    if (processed !== absPath) processedFiles.push(processed);
  }

  // 1.5. Imágenes de campos multilinea de portada
  if (multilineImages) {
    for (const img of multilineImages) {
      if (imageMap.has(img.absPath)) continue;

      // Si la imagen tiene width especificado, usar solo el ancho
      // para preservar la proporción (no forzar cuadrado)
      const imgTargetW = img.widthMm ?? targetW;
      const imgTargetH = img.widthMm ? 0 : targetH;

      const processed = await processImage(img.absPath, imgTargetW, imgTargetH, false, outputDir);
      imageMap.set(img.absPath, processed);
      if (processed !== img.absPath) processedFiles.push(processed);
    }
  }

  // 2. Imágenes inline del markdown
  for (const absPath of inlineImages) {
    if (imageMap.has(absPath)) continue;

    const processed = await processImage(absPath, targetW, targetH, false, outputDir);
    imageMap.set(absPath, processed);
    if (processed !== absPath) processedFiles.push(processed);
  }

  return { imageMap, processedFiles };
}
