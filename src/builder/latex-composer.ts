import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { execPandoc, MD_READER } from '../lib/pandoc-runner.js';
import { parseAuthors } from './discover.js';
import type { LuaFilterGroup } from './filter-resolver.js';
import { MBOX_HELPERS_FILTER } from './filter-resolver.js';
import { metadataValue } from './html-composer.js';
import type { PageDimensions } from './image-processor.js';
import { processDocumentImages, rewriteImagePaths, scanInlineImages, scanTitlePageFieldImages } from './image-processor.js';
import { babelOptionsForLang, pageNumberCommandFor } from './latex-preamble.js';
import type { BuildDocument } from './types.js';

/** Fecha cruda del frontmatter si es string no vacío tras recortar. */
function rawFrontmatterDate(fm: Record<string, unknown>): string | undefined {
  return typeof fm.date === 'string' && fm.date.trim() ? fm.date.trim() : undefined;
}

/**
 * Fecha efectiva como fallback cuando el frontmatter no trae fecha: birthtime
 * del documento. birthtime puede ser 0/epoch o NaN en filesystems que no lo
 * soportan (algunos Linux, NFS): en ese caso se usa mtime como último recurso
 * y se advierte para que el usuario sepa que la fecha es de modificación.
 */
async function fileCreationDate(doc: BuildDocument): Promise<string | undefined> {
  try {
    const fileStat = await Bun.file(doc.filePath).stat();
    const birthMs = fileStat.birthtimeMs;
    const noBirthtime = !Number.isFinite(birthMs) || birthMs <= 0;
    const btime = noBirthtime ? fileStat.mtime : fileStat.birthtime;
    if (!btime) return undefined;
    const y = btime.getFullYear();
    const m = String(btime.getMonth() + 1).padStart(2, '0');
    const d = String(btime.getDate()).padStart(2, '0');
    if (noBirthtime) {
      logWarning(`"${doc.filePath}" sin fecha de creación (birthtime); se usó la fecha de modificación`, 'latex');
    }
    return formatHumanDate(`${y}-${m}-${d}`);
  } catch {
    // Si no se puede leer el archivo, no agregar fecha
    return undefined;
  }
}

/**
 * Fecha de la portada del PDF: con show-date, la formateada del frontmatter (o
 * la creación del archivo); sin show-date, '' neutraliza el date del frontmatter
 * (la portada no muestra fecha). undefined = no hay nada que pasar.
 */
async function pdfDate(fm: Record<string, unknown>, siteConfig: SiteConfig, doc: BuildDocument): Promise<string | undefined> {
  const rawDate = rawFrontmatterDate(fm);
  if (siteConfig.format?.pdf?.showDate === true) {
    if (rawDate) return formatHumanDate(rawDate);
    return fileCreationDate(doc);
  }
  // Sin show-date: el frontmatter no debe mostrar fecha en la portada
  if (rawDate || fm.date !== undefined) return '';
  return undefined;
}

/**
 * Genera el cuerpo LaTeX completo (.tex final: preámbulo + cuerpo) desde el
 * markdown original en una sola invocación de pandoc, con el template
 * efectivo compuesto por el CLI. El filtro internal/flags calcula los flags
 * del preámbulo (TOC, espaciado, \noindent) y agrega \printbibliography.
 *
 * Contrato de metadatos: el frontmatter del documento (fm) es la fuente y la
 * config aporta defaults (lang, show-date); aquí se derivan los valores
 * efectivos (título, autores, fecha de portada). El subtitle NO se deriva
 * aquí: fluye del frontmatter a la metadata y el filtro latex/10-titlepages
 * lo serializa (multilínea con |).
 */
/**
 * Opciones de markdownToLatex (#2076): campos nombrados en vez de parámetros
 * posicionales largos con booleans al final.
 */
export interface LatexComposerOptions {
  filters: LuaFilterGroup;
  bibFiles: string[];
  templatePath: string;
  fm: Record<string, unknown>;
  siteConfig: SiteConfig;
  /** false si 11-bibliography está desactivado: flags.lua no inyecta \\printbibliography. */
  biblatexAvailable?: boolean;
  /** Registro de langs advertidos del build (babelOptionsForLang): una vez por build, no por proceso. */
  warnedLangs: Set<string>;
  /** Dimensiones de página en mm (para preprocesamiento de imágenes). undefined = sin preprocesar. */
  pageDimensions?: PageDimensions;
  /** Si true, endpapers usa +6mm (crop activo). */
  cropActive?: boolean;
  /** 99-pdfx activo (#2040): correlaciona el warning de magick con la certificación. */
  pdfxActive?: boolean;
}

/** Resultado del preprocesamiento de imágenes del documento. */
interface ImagePreprocessResult {
  imageMap: Map<string, string>;
  processedImages: string[];
  finalContent: string;
}

/**
 * Preprocesamiento de imágenes (CMYK 300dpi JPG): escanea inline y campos
 * multilinea de portada, procesa con ImageMagick y reescribe rutas en TODO
 * el contenido (frontmatter + body) si hubo cambios.
 */
async function preprocessDocumentImages(
  content: string,
  doc: BuildDocument,
  fm: Record<string, unknown>,
  pageDimensions: PageDimensions,
  cropActive: boolean,
  pdfxActive: boolean,
): Promise<ImagePreprocessResult> {
  const docDir = dirname(doc.filePath);
  const outputDir = join(docDir, '.iteraciones', 'processed-images');
  const inlineImages = scanInlineImages(content, docDir);
  const multilineImages = await scanTitlePageFieldImages(fm, docDir, pageDimensions.w);
  const result = await processDocumentImages(inlineImages, fm, docDir, pageDimensions, cropActive, outputDir, multilineImages, pdfxActive);
  if (result.imageMap.size === 0) return { imageMap: result.imageMap, processedImages: result.processedFiles, finalContent: content };
  return { imageMap: result.imageMap, processedImages: result.processedFiles, finalContent: rewriteImagePaths(content, result.imageMap, docDir) };
}

/** Valor string recortado de un campo frontmatter (undefined si vacío/otro tipo). */
function trimmedStringValue(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

/** Valida y añade la metadata de portada (title-image/publishers-image/endpapers). */
async function pushCoverImageMetadata(
  extraArgs: string[],
  fm: Record<string, unknown>,
  doc: BuildDocument,
  imageMap: Map<string, string>,
): Promise<void> {
  // title-image, publishers-image y endpapers: imágenes de la portada, del
  // logo del editor y de las guardas (solo LaTeX/PDF) que sustituyen o
  // decoran elementos del documento. Ruta relativa al directorio del
  // documento (o absoluta); se valida que exista para fallar con un mensaje
  // claro en vez del críptico de latexmk. El filter 10-titlepages las pasa
  // como RawInline latex (sin escapes: un guion bajo se rompería como \_ con
  // el writer).
  for (const field of ['title-image', 'publishers-image', 'endpapers']) {
    const value = trimmedStringValue(fm[field]);
    if (!value) continue;
    const imagePath = isAbsolute(value) ? value : resolve(dirname(doc.filePath), value);
    if (!(await Bun.file(imagePath).exists())) {
      throw new BuildError(`${field} no encontrado: "${imagePath}" (resuelto desde "${value}")`);
    }
    extraArgs.push(`--metadata=${field}:${imageMap.get(imagePath) ?? imagePath}`);
  }
}

export async function markdownToLatex(
  content: string,
  doc: BuildDocument,
  opts: LatexComposerOptions,
): Promise<{ tex: string; processedImages: string[] }> {
  const {
    filters,
    bibFiles,
    templatePath,
    fm,
    siteConfig,
    biblatexAvailable = true,
    warnedLangs,
    pageDimensions,
    cropActive = false,
    pdfxActive = false,
  } = opts;
  const title = typeof fm.title === 'string' && fm.title.trim() ? fm.title : 'Sin título';
  const creator = parseAuthors(fm.creator);

  // ── Preprocesamiento de imágenes (CMYK 300dpi JPG) ──
  let imageMap = new Map<string, string>();
  let processedImages: string[] = [];
  let finalContent = content;
  if (pageDimensions) {
    ({ imageMap, processedImages, finalContent } = await preprocessDocumentImages(content, doc, fm, pageDimensions, cropActive, pdfxActive));
  }

  const extraArgs = ['--template', templatePath, '--top-level-division', 'section', '--shift-heading-level-by=2'];
  // El fragmento babel del template efectivo se resuelve por el lang de la
  // configuración (el frontmatter lang no altera babel en el PDF: contrato
  // documentado en configuration.md).
  extraArgs.push(`--metadata=babel-lang:${babelOptionsForLang(siteConfig.language, warnedLangs)}`);
  extraArgs.push(`--metadata=biblatex-available:${biblatexAvailable}`);
  // Comando del número de página (posición configurada): flags.lua lo inserta
  // después del primer bloque cuando el body empieza con un title/list-opener
  // (la numeración empieza con el contenido); con un párrafo normal, el
  // template lo emite antes del body.
  const pageCommand = pageNumberCommandFor(siteConfig.format?.pdf?.pageNumber ?? 'header-right');
  if (pageCommand) {
    extraArgs.push(`--metadata=page-number-command:${pageCommand}`);
  }
  for (const filter of [...filters.semantic, ...filters.user, ...filters.flags, ...filters.latex]) {
    extraArgs.push('--lua-filter', filter);
  }
  if (bibFiles.length > 0) {
    extraArgs.push('--biblatex');
    for (const bib of bibFiles) {
      extraArgs.push('--bibliography', bib);
    }
  }
  extraArgs.push(`--metadata=title:${metadataValue(title)}`);
  await pushCoverImageMetadata(extraArgs, fm, doc, imageMap);
  // El subtitle NO se pasa por --metadata: el override aplanaría los \n con
  // metadataValue y el filtro latex/10-titlepages no vería el valor multilínea
  // (frontmatter con |). El filtro lo serializa desde la metadata del
  // documento: el template $if(subtitle)$ emite el RawInline latex sin
  // re-escape. En HTML el compositor sí lo aplana (render.ts).
  for (const a of creator) {
    extraArgs.push(`--metadata=creator:${metadataValue(a)}`);
  }
  const date = await pdfDate(fm, siteConfig, doc);
  if (date !== undefined) extraArgs.push(`--metadata=date:${metadataValue(date)}`);

  const tex = await execPandoc({
    input: finalContent,
    sourcePath: doc.filePath,
    from: MD_READER,
    to: 'latex',
    extraArgs,
    // Ruta absoluta del helper compartido de mbox: los filters 06/07 la usan
    // con dofile (el require relativo a PANDOC_SCRIPT_FILE falla si el
    // proyecto sobrescribe 06/07).
    env: { ITERACIONES_MBOX_HELPERS: MBOX_HELPERS_FILTER },
  });

  return { tex, processedImages };
}

/**
 * Distribución LaTeX portátil (ADR del issue #2084): el `.tex` de dist/ debe
 * compilar fuera del árbol del proyecto, así que cada imagen procesada viaja
 * a su lado con nombre namespaced por slug y el `.tex` distribuido referencia
 * esas copias con el filename pelado (el pipeline escribe las copias en el
 * mismo directorio que el .tex). El `.tex` del área de trabajo de latexmk
 * NO se reescribe: para compilar necesita las rutas absolutas procesadas.
 *
 * Basenames duplicados dentro de un mismo documento reciben sufijo `-2`,
 * `-3`… antes de la extensión.
 */
export function buildTexDistribution(processedImages: string[], outSlug: string): Map<string, string> {
  const map = new Map<string, string>();
  const taken = new Set<string>();
  for (const abs of processedImages) {
    const sep = abs.lastIndexOf('/');
    const base = sep >= 0 ? abs.slice(sep + 1) : abs;
    let name = `${outSlug}-${base}`;
    if (taken.has(name)) {
      const dot = base.lastIndexOf('.');
      name = dot > 0 ? `${outSlug}-${base.slice(0, dot)}-2${base.slice(dot)}` : `${outSlug}-${base}-2`;
      let n = 2;
      while (taken.has(name)) {
        n++;
        name = dot > 0 ? `${outSlug}-${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${outSlug}-${base}-${n}`;
      }
    }
    taken.add(name);
    map.set(abs, name);
  }
  return map;
}

/** Reemplaza cada ruta absoluta procesada por el filename relativo de la distribución. */
export function rewriteTexForDist(tex: string, distribution: Map<string, string>): string {
  let result = tex;
  for (const [abs, name] of distribution) {
    result = result.split(abs).join(name);
  }
  return result;
}
