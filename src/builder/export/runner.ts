import { existsSync, rmSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import type { EpubFormatConfig, HtmlFormatConfig, MarkdownFormatConfig, PdfFormatConfig, ThumbnailMode } from '../../config/site-config.js';
import { THUMBNAIL_SIZES } from '../../config/site-config.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import { convertFragment } from '../../services/pandoc-runner.js';
import { convertToEpub, convertToMarkdown, convertToPdf } from '../../services/pandoc-exporter.js';
import { computeSlug, docHref } from '../slug.js';
import type { BuildDocument, DocumentType } from '../types.js';
import {
  assembleAuthorExportVariants,
  assembleExportDocument,
  resolveEventsForExport,
  resolveItemsForExport,
  resolveLooseItemPaths,
  resolvePartsForExport,
} from './assemble.js';
import type { ExportCollectionPart, ExportDocument, ExportMetadata, ExportResult } from './types.js';
import { EXPORTABLE_TYPES } from './types.js';

/**
 * Tipos de thumbnail reconocidos:
 * - true: genera un solo JPG de 1200px (`<outputBase>.jpg`)
 * - 'responsive': genera sm(320), md(640), lg(1200), xl(2400)
 *   (`<outputBase>.<name>.jpg`)
 */
type ThumbnailRequest = { mode: true; coverPath: string } | { mode: 'responsive' };

const THUMBNAIL_DEFAULT_WIDTH = 1200;

/**
 * Determina qué thumbnails generar según el valor de ThumbnailMode.
 */
function resolveThumbnailRequest(mode: ThumbnailMode, outputBase: string): ThumbnailRequest | null {
  if (!mode) return null;
  if (mode === true) return { mode: true, coverPath: `${outputBase}.jpg` };
  if (mode === 'responsive') return { mode: 'responsive' };
  return null;
}

/**
 * Genera thumbnails JPG a partir de la primera página de un PDF.
 * Usa `pdftoppm` (parte de poppler-utils). Si no está disponible o falla, retorna undefined.
 *
 * @param pdfPath   Ruta absoluta al PDF fuente.
 * @param outputBase Ruta base de salida sin extensión (ej: /dist/web/notas/foo).
 * @param request   Configuración de qué thumbnails generar.
 * @param statCache Mapa opcional para cachear stat() del PDF.
 * @returns Ruta absoluta al JPG principal (lg en responsive, único en simple), o undefined.
 */
async function generateCoverImage(pdfPath: string, outputBase: string, request: ThumbnailRequest): Promise<string | undefined> {
  try {
    if (request.mode === true) {
      // Modo simple: un solo JPG de 1200px
      const coverPath = request.coverPath;
      const [coverStat, pdfStat] = await Promise.all([stat(coverPath).catch(() => null), stat(pdfPath)]);
      if (coverStat && coverStat.mtimeMs >= pdfStat.mtimeMs) return coverPath;
      const proc = Bun.spawn(['pdftoppm', '-r', '150', '-jpeg', '-singlefile', '-scale-to', String(THUMBNAIL_DEFAULT_WIDTH), pdfPath, outputBase], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) return undefined;
      const exists = await Bun.file(coverPath).exists();
      return exists ? coverPath : undefined;
    }

    // Modo responsive: generar sm, md, lg, xl
    const pdfStat = await stat(pdfPath);
    let coverPath: string | undefined;

    for (const [name, width] of Object.entries(THUMBNAIL_SIZES)) {
      const sizePath = `${outputBase}.${name}.jpg`;
      try {
        const existing = await stat(sizePath).catch(() => null);
        if (existing && existing.mtimeMs >= pdfStat.mtimeMs) {
          if (width === THUMBNAIL_DEFAULT_WIDTH) coverPath = sizePath;
          continue;
        }
      } catch {}

      const proc = Bun.spawn(['pdftoppm', '-r', '150', '-jpeg', '-singlefile', '-scale-to', String(width), pdfPath, `${outputBase}.${name}`], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const exitCode = await proc.exited;
      if (
        exitCode === 0 &&
        (await Bun.file(sizePath)
          .exists()
          .catch(() => false))
      ) {
        if (width === THUMBNAIL_DEFAULT_WIDTH) coverPath = sizePath;
      }
    }

    return coverPath;
  } catch {
    // pdftoppm no instalado o no disponible en PATH — no es error fatal
    return undefined;
  }
}

export interface ExportFormatOptions {
  pdf?: PdfFormatConfig;
  epub?: EpubFormatConfig;
  markdown?: MarkdownFormatConfig;
  html?: HtmlFormatConfig;
}

export interface ExportRunOptions {
  config: ExportFormatOptions;
  outputDir: string;
  /** Directorio raíz del proyecto; usado para validar rutas editoriales (cover, bibliography, csl) y para resolver rutas globales. */
  cwd: string;
  lang: string;
  /**
   * Numero maximo de documentos que se procesan en paralelo en el outer loop.
   * Cuando la exportacion incluye PDF, un semaforo interno limita las instancias
   * de pdflatex activas simultaneamente a `config.pdf.concurrency`; `concurrency` sigue
   * siendo el limite de documentos en vuelo (incluidos los que esperan el semaforo).
   */
  concurrency: number;
  /** Versión del CLI para la clave de caché. */
  cliVersion: string;
  /** Versión de pandoc para la clave de caché. */
  pandocVersion: string;
  cacheManager?: CacheManager;
  /** Registro de plugins para ejecutar los hooks beforeExport/afterExport. */
  registry?: PluginRegistry;
  /** Hash del contenido de los plugins activos, para incluir en la clave de caché. */
  pluginFingerprint?: string;
  /** Acumulador de estadísticas de exportación. Se muta durante la ejecución. */
  stats?: ExportStats;
  /**
   * Callback invocado por cada formato exportado (PDF/EPUB) para reporte de progreso.
   * En modo verbose se espera que muestre una línea por archivo;
   * en modo normal avanza la barra de progreso.
   */
  onExportProgress?: (relativePath: string, cacheHit: boolean) => void;
}

/** Contadores acumulativos de la fase de exportación; se mutan durante la ejecución. */
export interface ExportStats {
  totalEpub: number;
  totalPdf: number;
  totalMd: number;
  cacheHitsEpub: number;
  cacheHitsPdf: number;
  cacheHitsMd: number;
}

/**
 * Ejecuta la exportación de todos los documentos exportables.
 *
 * Itera sobre los tipos en EXPORTABLE_TYPES, construye el ExportDocument
 * para cada doc (ensamblando capítulos para collection/events), y genera
 * los archivos PDF y EPUB solicitados en `config.formats`.
 *
 * Los archivos exportados se escriben en `outputDir` junto a sus equivalentes HTML.
 *
 * @param renderedMap  Mapa de todos los docs renderizados por tipo (completo, post context-phase).
 * @param options      Configuración de exportación y opciones de runtime.
 */

/**
 * Resuelve y valida una ruta de configuración global (bibliography, csl) dentro del proyecto.
 *
 * Normaliza la ruta con `resolve()` para eliminar `..` y rutas relativas, y verifica que
 * quede dentro de `cwd`. Emite un aviso por stderr y retorna `undefined` si la ruta es
 * exterior al proyecto. Compartida entre `runExportDocuments` y `exportSingleDocument`.
 */
function resolveExportGlobalPath(raw: string | undefined, cwd: string, field: string): string | undefined {
  if (!raw) return undefined;
  // resolve() normaliza siempre: elimina '..', maneja rutas relativas y absolutas.
  // Una ruta absoluta con '..' como '/project/../etc/passwd' queda normalizada a '/etc/passwd'.
  const resolved = resolve(cwd, raw);
  // Usar relative() en lugar de startsWith() para una verificación cross-platform:
  // en Windows, cwd usa '\\' y cwd+'/' no coincide con las rutas resueltas.
  // relative(cwd, resolved) devuelve '' o una ruta sin '..' inicial si resolved está dentro.
  const rel = relative(cwd, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    process.stderr.write(`[export] export.${field}: ruta fuera del proyecto ignorada: "${raw}"\n`);
    return undefined;
  }
  return resolved;
}

// Semáforo module-level compartido entre peticiones on-demand concurrentes.
// Limita las instancias de pdflatex lanzadas desde exportSingleDocument cuando el
// usuario abre múltiples PDFs en simultáneo (pestañas, prefetch, recargas).
// Se inicializa con el primer valor de pdfConcurrency que recibe; si cambia
// en recargas posteriores del config, el valor inicial sigue vigente.
let _onDemandLatexSlots = -1;
const _onDemandLatexQueue: Array<() => void> = [];

function acquireOnDemandLatex(maxSlots: number): Promise<void> {
  if (_onDemandLatexSlots < 0) _onDemandLatexSlots = maxSlots;
  return new Promise<void>((res) => {
    if (_onDemandLatexSlots > 0) {
      _onDemandLatexSlots--;
      res();
    } else {
      _onDemandLatexQueue.push(res);
    }
  });
}

function releaseOnDemandLatex(): void {
  const next = _onDemandLatexQueue.shift();
  if (next) {
    next();
  } else {
    _onDemandLatexSlots++;
  }
}

/**
 * Calcula la ruta base de salida para un ExportDocument.
 * Usa el slug (autor-título) si está disponible, con soporte para la variante
 * `-completo` de autores. Si no hay slug, usa el nombre del archivo fuente.
 */
function exportOutputBase(exportDoc: ExportDocument, outputDir: string): string {
  const dir = dirname(exportDoc.relativePath);
  const dirPart = dir === '.' ? '' : dir;

  if (exportDoc.slug) {
    return join(outputDir, dirPart, exportDoc.slug);
  }

  const computed = computeSlug(exportDoc.metadata);
  // Evitar usar el título genérico 'Sin título' para nombrar archivos.
  if (computed && exportDoc.metadata.title !== 'Sin título') {
    return join(outputDir, dirPart, computed);
  }

  // Último recurso: usar el nombre original del archivo.
  return join(outputDir, exportDoc.relativePath.replace(/\.md$/, ''));
}

export async function runExportDocuments(
  renderedMap: ReadonlyMap<DocumentType, BuildDocument[]>,
  options: ExportRunOptions,
): Promise<ExportResult[]> {
  const { config, outputDir, cwd, lang, concurrency, cliVersion, pandocVersion, cacheManager, registry, pluginFingerprint, stats } = options;

  const hasPdf = config.pdf?.generate === true || (config.html?.thumbnails ? true : false);
  const hasEpub = config.epub?.generate === true;
  // Semaforo interno que limita las instancias de pdflatex concurrentes sin afectar EPUB.
  // El outer mapWithConcurrency usa el limite general (concurrency); dentro del branch
  // PDF se adquiere un slot antes de invocar pdflatex y se libera al terminar — con o
  // sin error. Asi el numero de documentos en vuelo es `concurrency`, pero las llamadas
  // a pdflatex activas simultaneamente se acotan a `pdfConcurrency` (~300-600 MB/proceso).
  let latexSlots = hasPdf ? (Number.isInteger(config.pdf?.concurrency) && config.pdf!.concurrency! >= 1 ? config.pdf!.concurrency! : 1) : 0;
  const latexQueue: Array<() => void> = [];
  const acquireLatex = (): Promise<void> =>
    new Promise<void>((res) => {
      if (latexSlots > 0) {
        latexSlots--;
        res();
      } else {
        latexQueue.push(res);
      }
    });
  const releaseLatex = (): void => {
    const next = latexQueue.shift();
    if (next) {
      next();
    } else {
      latexSlots++;
    }
  };

  // Auto-descubrir archivos .bib en el proyecto
  let globalBibliography: string | undefined;
  try {
    const glob = new Bun.Glob('**/*.bib');
    for (const file of glob.scanSync({ cwd, absolute: true })) {
      const rel = file.replace(cwd, '').replace(/^\/+/, '');
      if (rel.startsWith('node_modules/') || rel.startsWith('.iteraciones/') || rel.startsWith('dist/') || rel.startsWith('.git/')) continue;
      globalBibliography = file;
      break; // usar el primer .bib encontrado
    }
  } catch {}
  let globalCsl = undefined;

  // Hash del archivo .bib global (si existe) para invalidar caché cuando cambia.
  let bibHash = '';
  if (globalBibliography) {
    const bibFile = Bun.file(globalBibliography);
    if (await bibFile.exists()) {
      try {
        const bibText = await bibFile.text();
        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update(bibText);
        bibHash = hasher.digest('hex');
      } catch (err) {
        process.stderr.write(`[export] no se pudo leer export.bibliography para caché: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  // Hash del archivo .csl global (si existe) para invalidar caché cuando cambia el estilo.
  let cslHash = '';
  if (globalCsl) {
    const cslFile = Bun.file(globalCsl);
    if (await cslFile.exists()) {
      try {
        const cslText = await cslFile.text();
        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update(cslText);
        cslHash = hasher.digest('hex');
      } catch (err) {
        process.stderr.write(`[export] no se pudo leer export.csl para caché: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  // Hash de los templates de exportación (*.latex, *.css) y fuentes TTF para
  // invalidar caché cuando se modifica el diseño del PDF/EPUB o las fuentes,
  // sin cambiar el contenido fuente.
  // Se escanea el directorio dinámicamente para incluir cualquier template nuevo
  // sin necesidad de actualizar una lista manual.
  const EXPORT_TEMPLATES_DIR = join(import.meta.dir, '../../../pandoc/export');
  const FONTS_DIR = join(import.meta.dir, '../../../fonts');
  let templateHash = '';
  try {
    const tplHasher = new Bun.CryptoHasher('sha256');
    const tplFiles: string[] = [];
    for await (const f of new Bun.Glob('*.latex').scan({
      cwd: EXPORT_TEMPLATES_DIR,
    })) {
      tplFiles.push(f);
    }
    for await (const f of new Bun.Glob('*.css').scan({
      cwd: EXPORT_TEMPLATES_DIR,
    })) {
      tplFiles.push(f);
    }
    tplFiles.sort(); // orden determinístico para un hash estable
    for (const filename of tplFiles) {
      tplHasher.update(await Bun.file(join(EXPORT_TEMPLATES_DIR, filename)).text());
      tplHasher.update('\0');
    }
    // Incluir las fuentes TTF para la caché de EPUB (las embebe en el archivo).
    const fontFiles: string[] = [];
    for await (const f of new Bun.Glob('*.ttf').scan({ cwd: FONTS_DIR })) {
      fontFiles.push(f);
    }
    fontFiles.sort();
    for (const filename of fontFiles) {
      const buf = await Bun.file(join(FONTS_DIR, filename)).arrayBuffer();
      tplHasher.update(new Uint8Array(buf));
      tplHasher.update('\0');
    }
    templateHash = tplHasher.digest('hex');
  } catch (err) {
    process.stderr.write(`[export] no se pudo calcular hash de templates/fuentes: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  // Pool de items primarios para resolver colecciones y programas de eventos.
  const itemPool = [...(renderedMap.get('file') ?? []), ...(renderedMap.get('author') ?? []), ...(renderedMap.get('event') ?? [])];
  const eventPool = renderedMap.get('event') ?? [];

  // Recopilar todos los docs exportables (no-bloques) de los tipos registrados.
  const exportableDocs: BuildDocument[] = [];
  for (const type of EXPORTABLE_TYPES) {
    const docs = (renderedMap.get(type) ?? []).filter((d) => d.kind !== 'block');
    exportableDocs.push(...docs);
  }

  if (exportableDocs.length === 0) return [];

  let pdfDone = 0;
  // Los autores generan 2 PDFs cada uno (summary + full), por eso se cuentan por separado.
  const pdfTotal = hasPdf
    ? exportableDocs.reduce((acc, d) => {
        const raw = d.frontmatter['export'];
        const skipped =
          typeof raw === 'object' &&
          raw !== null &&
          !Array.isArray(raw) &&
          Object.getPrototypeOf(raw) === Object.prototype &&
          (raw as Record<string, unknown>)['skip'] === true;
        if (skipped) return acc;
        return acc + (d.type === 'author' ? 2 : 1);
      }, 0)
    : 0;

  // Closure que genera los formatos (epub, pdf) para un ExportDocument ya ensamblado.
  // `sourceHash` es el hash del documento fuente original (para la clave de caché).
  // `itemHashes` es la cadena de hashes de los ítems incluidos (string vacío para
  // documentos sin ítems como author).
  async function generateFormats(
    exportDoc: ExportDocument,
    outputBase: string,
    sourceHash: string,
    itemHashes: string,
  ): Promise<Array<PromiseSettledResult<{ epub?: string; pdf?: string; md?: string }>>> {
    const tasks: Array<Promise<{ epub?: string; pdf?: string; md?: string }>> = [];
    const mdCacheKey = hash(sourceHash, itemHashes, 'md', cliVersion, pandocVersion, pluginFingerprint ?? '', bibHash, cslHash, templateHash);

    if (config.markdown?.generate) {
      const outputPath = `${outputBase}.md`;
      tasks.push(
        (async () => {
          if (cacheManager && (await cacheManager.hasBinary('export', mdCacheKey, 'md'))) {
            await cacheManager.copyBinaryTo('export', mdCacheKey, 'md', outputPath);
            if (stats) {
              stats.totalMd++;
              stats.cacheHitsMd++;
            }
            return { md: outputPath };
          }
          await convertToMarkdown(exportDoc, outputPath);
          if (cacheManager) {
            const content = await Bun.file(outputPath).text();
            await cacheManager.write('export', mdCacheKey, content);
          }
          if (stats) stats.totalMd++;
          return { md: outputPath };
        })(),
      );
    }

    if (config.epub?.generate) {
      const outputPath = `${outputBase}.epub`;
      const cacheKey = hash(sourceHash, itemHashes, 'epub', cliVersion, pandocVersion, pluginFingerprint ?? '', bibHash, cslHash, templateHash);
      tasks.push(
        (async () => {
          if (cacheManager && (await cacheManager.hasBinary('export', cacheKey, 'epub'))) {
            await cacheManager.copyBinaryTo('export', cacheKey, 'epub', outputPath);
            if (stats) {
              stats.totalEpub++;
              stats.cacheHitsEpub++;
            }
            return { epub: outputPath };
          }
          const epubHtml = exportDoc.htmlBody ?? await convertFragment(exportDoc.body, exportDoc.filePath, undefined, undefined, undefined, 'html5', 'latex');
          await convertToEpub(epubHtml, outputPath, exportDoc);
          const epubData = await Bun.file(outputPath).arrayBuffer();
          if (registry) {
            const afterCtx = await registry.runAfterExport({
              sourcePath: exportDoc.filePath,
              format: 'epub',
              data: new Uint8Array(epubData),
            });
            await Bun.write(outputPath, afterCtx.data);
            if (cacheManager) await cacheManager.writeBinary('export', cacheKey, 'epub', afterCtx.data.slice().buffer as ArrayBuffer);
          } else if (cacheManager) {
            await cacheManager.writeBinary('export', cacheKey, 'epub', epubData);
          }
          if (stats) stats.totalEpub++;
          return { epub: outputPath };
        })(),
      );
    }

    // Generar PDF si esta configurado o si se necesitan thumbnails para HTML
    const genPdf = config.pdf?.generate || (config.html?.thumbnails && config.pdf);
    if (genPdf && config.pdf) {
      const outputPath = `${outputBase}.pdf`;
      const cacheKey = hash(
        sourceHash,
        itemHashes,
        'pdf',
        config.pdf.engine,
        cliVersion,
        pandocVersion,
        pluginFingerprint ?? '',
        bibHash,
        cslHash,
        templateHash,
      );
      tasks.push(
        (async () => {
          if (cacheManager && (await cacheManager.hasBinary('export', cacheKey, 'pdf'))) {
            await cacheManager.copyBinaryTo('export', cacheKey, 'pdf', outputPath);
            if (stats) {
              stats.totalPdf++;
              stats.cacheHitsPdf++;
            }
            pdfDone++;
            options.onExportProgress?.(exportDoc.relativePath, true);
            return { pdf: outputPath };
          }
          await acquireLatex();
          try {
            await convertToPdf(exportDoc, outputPath, cwd, config.pdf);
          } finally {
            releaseLatex();
          }
          // Si convertToPdf no generó el PDF (ej: sin .tex final), salir
          if (!existsSync(outputPath)) {
            return {};
          }
          const pdfData = await Bun.file(outputPath).arrayBuffer();
          if (registry) {
            const afterCtx = await registry.runAfterExport({
              sourcePath: exportDoc.filePath,
              format: 'pdf',
              data: new Uint8Array(pdfData),
            });
            await Bun.write(outputPath, afterCtx.data);
            if (cacheManager) await cacheManager.writeBinary('export', cacheKey, 'pdf', afterCtx.data.slice().buffer as ArrayBuffer);
          } else if (cacheManager) {
            await cacheManager.writeBinary('export', cacheKey, 'pdf', pdfData);
          }
          if (stats) stats.totalPdf++;
          pdfDone++;
          options.onExportProgress?.(exportDoc.relativePath, false);
          return { pdf: outputPath };
        })(),
      );
    }

    return Promise.allSettled(tasks);
  }

  const results = await mapWithConcurrency(exportableDocs, concurrency, async (doc): Promise<ExportResult | null> => {
    // Respetar export: { skip: true } en el frontmatter del documento.
    // Se valida que sea un objeto plano (sin arrays ni prototipos no-Object)
    // siguiendo el patrón del codebase en normalizeSpeaker/parseFrontmatter.
    const rawExportField = doc.frontmatter['export'];
    if (
      typeof rawExportField === 'object' &&
      rawExportField !== null &&
      !Array.isArray(rawExportField) &&
      Object.getPrototypeOf(rawExportField) === Object.prototype &&
      (rawExportField as Record<string, unknown>)['skip'] === true
    ) {
      return null;
    }

    // Resolver items según el tipo del documento
    // Author: exportación especial con dos variantes (perfil y completo)
    if (doc.type === 'author') {
      const fileDocs = renderedMap.get('file') ?? [];
      const { summary: rawSummary, full: rawFull } = assembleAuthorExportVariants(doc, [...fileDocs], lang, cwd, globalBibliography, globalCsl);

      let summaryDoc = rawSummary;
      let fullDoc = rawFull;
      if (registry) {
        const [sBefore, fBefore] = await Promise.all([
          registry.runBeforeExport({
            sourcePath: rawSummary.filePath,
            body: rawSummary.body,
            metadata: rawSummary.metadata as unknown as Record<string, unknown>,
          }),
          registry.runBeforeExport({
            sourcePath: rawFull.filePath,
            body: rawFull.body,
            metadata: rawFull.metadata as unknown as Record<string, unknown>,
          }),
        ]);
        summaryDoc = {
          ...rawSummary,
          body: sBefore.body,
          metadata: {
            ...rawSummary.metadata,
            ...(sBefore.metadata as Partial<ExportMetadata>),
          },
        };
        fullDoc = {
          ...rawFull,
          body: fBefore.body,
          metadata: {
            ...rawFull.metadata,
            ...(fBefore.metadata as Partial<ExportMetadata>),
          },
        };
      }

      const summaryBase = exportOutputBase(summaryDoc, outputDir);
      const fullBase = exportOutputBase(fullDoc, outputDir);

      // Hashes de obras del autor para la clave de caché
      const authorName = (doc.frontmatter.title || '').trim().toLowerCase();
      const authorItemHashes = fileDocs
        .filter((f) => f.kind !== 'block' && f.frontmatter.author.some((a) => a.trim().toLowerCase() === authorName))
        .map((f) => f.sourceHash)
        .join('\0');

      const [summaryResults, fullResults] = await Promise.all([
        generateFormats(summaryDoc, summaryBase, doc.sourceHash, authorItemHashes),
        generateFormats(fullDoc, fullBase, doc.sourceHash, `${authorItemHashes}\0full`),
      ]);

      const result: ExportResult = {
        filePath: doc.filePath,
        relativePath: doc.relativePath,
      };
      let firstError: unknown;
      for (const fr of summaryResults) {
        if (fr.status === 'fulfilled') {
          if (fr.value.epub) result.epubPath = fr.value.epub;
          if (fr.value.pdf) result.pdfPath = fr.value.pdf;
        } else if (!firstError) {
          firstError = fr.reason;
        }
      }
      for (const fr of fullResults) {
        if (fr.status === 'fulfilled') {
          if (fr.value.epub) result.epubFullPath = fr.value.epub;
          if (fr.value.pdf) result.pdfFullPath = fr.value.pdf;
        } else if (!firstError) {
          firstError = fr.reason;
        }
      }
      if (firstError) throw firstError;
      if (result.pdfPath && config.html?.thumbnails) {
        const request = resolveThumbnailRequest(config.html.thumbnails, summaryBase);
        if (request) result.coverPath = await generateCoverImage(result.pdfPath, summaryBase, request);
        // Eliminar PDF si solo se genero para thumbnails
        if (!config.pdf?.generate && config.pdf?.force) {
          rmSync(result.pdfPath);
        }
      }
      return result;
    }

    // Resolver items según el tipo del documento (non-author)
    let items: BuildDocument[] = [];
    let partGroups: ExportCollectionPart[] = [];
    if (doc.type === 'collection') {
      items = resolveItemsForExport(doc, itemPool);
      partGroups = resolvePartsForExport(doc, itemPool);
    } else if (doc.type === 'events') {
      items = resolveEventsForExport(doc, eventPool);
    }

    const loosePaths = doc.type === 'collection' ? resolveLooseItemPaths(doc) : undefined;

    const rawExportDoc = assembleExportDocument(
      doc,
      items,
      lang,
      cwd,
      globalBibliography,
      globalCsl,
      partGroups.length > 0 ? partGroups : undefined,
      config.pdf,
      loosePaths,
    );
    if (!rawExportDoc) return null;

    // Hook beforeExport: permite a los plugins modificar el body y/o los metadatos
    // del documento antes de que pandoc genere el PDF/EPUB.
    // Nota: el plugin es responsable de respetar la forma de ExportMetadata al
    // retornar metadata modificada — campos desconocidos se pasan tal cual a pandoc.
    let exportDoc = rawExportDoc;
    if (registry) {
      const beforeCtx = await registry.runBeforeExport({
        sourcePath: rawExportDoc.filePath,
        body: rawExportDoc.body,
        metadata: rawExportDoc.metadata as unknown as Record<string, unknown>,
      });
      exportDoc = {
        ...rawExportDoc,
        body: beforeCtx.body,
        metadata: {
          ...rawExportDoc.metadata,
          ...(beforeCtx.metadata as Partial<ExportMetadata>),
        },
      };
    }

    const outputBase = exportOutputBase(exportDoc, outputDir);
    // Hash de items pre-computado una sola vez: compartido por todos los formatos
    // del documento. Evita la duplicación del cálculo que había en el loop secuencial.
    const itemHashes = items.map((i) => i.sourceHash).join('\0');

    // Generar todos los formatos en paralelo: PDF y EPUB son completamente
    // independientes para el mismo documento y no comparten estado de escritura.
    // Promise.allSettled garantiza que ambos formatos terminan (éxito o error)
    // antes de propagar el primer error, de modo que no quedan promesas en vuelo
    // cuando la función retorna o lanza. No evita que un formato escriba en caché
    // aunque el otro falle después.
    const formatResults = await generateFormats(exportDoc, outputBase, doc.sourceHash, itemHashes);

    // Recopilar resultados exitosos y acumular errores.
    // Re-lanzar el primer error si algún formato falló (mantiene el comportamiento
    // de fallo explícito), pero todos los formatos ya completaron su ejecución.
    const result: ExportResult = {
      filePath: exportDoc.filePath,
      relativePath: exportDoc.relativePath,
    };
    let firstError: unknown;
    for (const fr of formatResults) {
      if (fr.status === 'fulfilled') {
        if (fr.value.epub) result.epubPath = fr.value.epub;
        if (fr.value.pdf) result.pdfPath = fr.value.pdf;
        if (fr.value.md) result.markdownPath = fr.value.md;
      } else if (!firstError) {
        firstError = fr.reason;
      }
    }
    if (firstError) throw firstError;
    // Generar thumbnail(s) JPG de la primera pagina del PDF (si configurado).
    if (result.pdfPath && config.html?.thumbnails) {
      const request = resolveThumbnailRequest(config.html.thumbnails, outputBase);
      if (request) {
        result.coverPath = await generateCoverImage(result.pdfPath, outputBase, request);
      }
      // Eliminar PDF si solo se genero para thumbnails
      if (!config.pdf?.generate && config.pdf?.force) {
        rmSync(result.pdfPath);
      }
    }
    return result;
  });

  return results.filter((r): r is ExportResult => r !== null);
}

/**
 * Inyecta las variables `download-pdf` y `download-epub` en el templateContext
 * de los docs que tienen resultados de exportación.
 *
 * Usa `doc.filePath` como clave (en lugar de `relativePath`) para que los docs
 * paginados reciban los enlaces de descarga del libro completo.
 *
 * Las URLs son root-relative (empiezan con '/') para que `makeRelativeContext`
 * las convierta a rutas relativas en el HTML final.
 *
 * Variables de template producidas:
 *   download-pdf   → URL root-relative del PDF exportado
 *   download-epub  → URL root-relative del EPUB exportado
 *   cover-image    → URL root-relative de la portada JPG (si se generó con pdftoppm)
 */
export function injectDownloadLinks(docs: BuildDocument[], exportResults: ExportResult[], outputDir: string): BuildDocument[] {
  if (exportResults.length === 0) return docs;
  const byFilePath = new Map<string, ExportResult>(exportResults.map((r) => [r.filePath, r]));

  return docs.map((doc) => {
    const result = byFilePath.get(doc.filePath);
    if (!result || !doc.templateContext) return doc;

    const extra: Record<string, string> = {};
    if (result.pdfPath) {
      // Convertir ruta absoluta a root-relative: outputDir = dist/web, pdfPath = dist/web/notas/a.pdf
      // → /notas/a.pdf
      const rel = result.pdfPath.slice(outputDir.length).replace(/\\/g, '/');
      extra['download-pdf'] = rel.startsWith('/') ? rel : `/${rel}`;
    }
    if (result.epubPath) {
      const rel = result.epubPath.slice(outputDir.length).replace(/\\/g, '/');
      extra['download-epub'] = rel.startsWith('/') ? rel : `/${rel}`;
    }
    if (result.markdownPath) {
      const rel = result.markdownPath.slice(outputDir.length).replace(/\\/g, '/');
      extra['download-md'] = rel.startsWith('/') ? rel : `/${rel}`;
    }
    if (result.coverPath) {
      const rel = result.coverPath.slice(outputDir.length).replace(/\\/g, '/');
      extra['cover-image'] = rel.startsWith('/') ? rel : `/${rel}`;
    }
    if (result.pdfFullPath) {
      const rel = result.pdfFullPath.slice(outputDir.length).replace(/\\/g, '/');
      extra['download-pdf-completo'] = rel.startsWith('/') ? rel : `/${rel}`;
    }
    if (result.epubFullPath) {
      const rel = result.epubFullPath.slice(outputDir.length).replace(/\\/g, '/');
      extra['download-epub-completo'] = rel.startsWith('/') ? rel : `/${rel}`;
    }
    if (Object.keys(extra).length === 0) return doc;
    return { ...doc, templateContext: { ...doc.templateContext, ...extra } };
  });
}

/**
 * Propaga los enlaces de descarga (`download-pdf`, `download-epub`) de los documentos
 * hoja hacia los ítems (`list-items`) de cualquier documento que los referencie por `href`.
 *
 * Llamar justo después de `injectDownloadLinks` para que `download-pdf`/`download-epub`
 * ya estén inyectados en el templateContext de cada documento exportado.
 */
export function injectDownloadLinksIntoListItems(docs: BuildDocument[]): BuildDocument[] {
  const linksByHref = new Map<string, Record<string, string>>();
  for (const doc of docs) {
    if (!doc.templateContext) continue;
    const pdf = doc.templateContext['download-pdf'];
    const epub = doc.templateContext['download-epub'];
    if (typeof pdf !== 'string' && typeof epub !== 'string') continue;
    const href = docHref(doc);
    linksByHref.set(href, {
      ...(typeof pdf === 'string' && { 'download-pdf': pdf }),
      ...(typeof epub === 'string' && { 'download-epub': epub }),
    });
  }
  if (linksByHref.size === 0) return docs;
  return docs.map((doc) => {
    if (!doc.templateContext) return doc;
    const items = doc.templateContext['list-items'];
    if (!Array.isArray(items) || items.length === 0) return doc;
    let changed = false;
    const updatedItems = items.map((item: unknown) => {
      if (!item || typeof item !== 'object') return item;
      const itemObj = item as Record<string, unknown>;
      const href = itemObj['href'];
      if (typeof href !== 'string') return item;
      const links = linksByHref.get(href);
      if (!links) return item;
      changed = true;
      return { ...itemObj, ...links };
    });
    if (!changed) return doc;
    return {
      ...doc,
      templateContext: { ...doc.templateContext, 'list-items': updatedItems },
    };
  });
}

/**
 * Propaga `cover-image` de los documentos hoja hacia los ítems (`list-items`)
 * de cualquier documento que los referencie por `href`.
 *
 * Llamar después de que `cover-image` esté disponible en el `templateContext`
 * de cada documento exportado (es decir, tras `injectDownloadLinks`).
 */
export function injectCoverIntoListItems(docs: BuildDocument[]): BuildDocument[] {
  const coverByHref = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.templateContext) continue;
    const cover = doc.templateContext['cover-image'];
    if (typeof cover !== 'string') continue;
    const href = docHref(doc);
    coverByHref.set(href, cover);
  }
  if (coverByHref.size === 0) return docs;
  return docs.map((doc) => {
    if (!doc.templateContext) return doc;
    const ctx = doc.templateContext;

    // Helper: inyecta cover-image en un array de items (list-items, loose-items, partes)
    // Cada item sin match recibe '' para impedir fallback al contexto padre.
    const injectItems = (items: unknown[]): unknown[] =>
      items.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const itemObj = item as Record<string, unknown>;
        const href = itemObj['href'];
        if (typeof href !== 'string') return { ...itemObj, 'cover-image': '' };
        const cover = coverByHref.get(href);
        return { ...itemObj, 'cover-image': cover ?? '' };
      });

    const result: Record<string, unknown> = { ...ctx };

    if (Array.isArray(result['list-items'])) {
      result['list-items'] = injectItems(result['list-items']);
    }
    if (Array.isArray(result['loose-items'])) {
      result['loose-items'] = injectItems(result['loose-items']);
    }
    if (Array.isArray(result['parts'])) {
      result['parts'] = (result['parts'] as unknown[]).map((part) => {
        if (!part || typeof part !== 'object') return part;
        const partObj = part as Record<string, unknown>;
        const items = partObj['items'];
        if (!Array.isArray(items)) return part;
        return { ...partObj, items: injectItems(items) };
      });
    }

    return { ...doc, templateContext: result };
  });
}

/**
 * Exporta un único documento a PDF bajo demanda (serve mode).
 *
 * Busca en `renderedMap` el documento cuyo `relativePath` (con extensión `.md`)
 * coincide con `pdfRelPath` (extensión `.pdf`) y genera el PDF en `outputDir`.
 *
 * @param pdfRelPath  Ruta relativa del PDF pedido (ej: `notas/foo.pdf`).
 * @param renderedMap Mapa de documentos renderizados del último build.
 * @param options     Opciones de exportación (config, outputDir, cwd, etc.).
 * @returns           Ruta absoluta del PDF generado, o null si el documento
 *                    no existe, no es exportable, o la exportación falla.
 */
export async function exportSingleDocument(
  pdfRelPath: string,
  renderedMap: ReadonlyMap<DocumentType, BuildDocument[]>,
  options: ExportRunOptions,
): Promise<string | null> {
  const { config, outputDir, cwd, lang, registry } = options;

  if (!config.pdf) return null;

  // Normalizar separadores (forward slashes) y derivar la ruta .md esperada.
  // El reemplazo es case-insensitive para tolerar URLs con .PDF o .Pdf.
  const normalizedPdfRelPath = pdfRelPath.replace(/\\/g, '/');
  const expectedRelPath = normalizedPdfRelPath.replace(/\.pdf$/i, '.md');

  // Detectar petición de variante completa (autor): /personas/nombre-completo.pdf
  // → buscar el doc base /personas/nombre.md de tipo author y generar la variante full.
  const isCompleto = /-completo\.md$/.test(expectedRelPath);
  const lookupRelPath = isCompleto ? expectedRelPath.replace(/-completo\.md$/, '.md') : expectedRelPath;

  // Buscar el documento en todos los tipos exportables del renderedMap.
  let targetDoc: BuildDocument | undefined;
  for (const type of EXPORTABLE_TYPES) {
    targetDoc = (renderedMap.get(type) ?? []).find((d) => d.kind !== 'block' && d.relativePath === lookupRelPath);
    if (targetDoc) break;
  }
  if (!targetDoc) return null;

  // La variante completa solo existe para documentos de tipo author.
  if (isCompleto && targetDoc.type !== 'author') return null;

  // Respetar export: { skip: true } en el frontmatter del documento.
  const rawExportField = targetDoc.frontmatter['export'];
  if (
    typeof rawExportField === 'object' &&
    rawExportField !== null &&
    !Array.isArray(rawExportField) &&
    Object.getPrototypeOf(rawExportField) === Object.prototype &&
    (rawExportField as Record<string, unknown>)['skip'] === true
  ) {
    return null;
  }

  // Resolver items para tipos colección/eventos.
  const itemPool = [...(renderedMap.get('file') ?? []), ...(renderedMap.get('author') ?? []), ...(renderedMap.get('event') ?? [])];
  const eventPool = renderedMap.get('event') ?? [];

  // Auto-descubrir archivos .bib en el proyecto
  let globalBibliography: string | undefined;
  try {
    const glob = new Bun.Glob('**/*.bib');
    for (const file of glob.scanSync({ cwd, absolute: true })) {
      const rel = file.replace(cwd, '').replace(/^\/+/, '');
      if (rel.startsWith('node_modules/') || rel.startsWith('.iteraciones/') || rel.startsWith('dist/') || rel.startsWith('.git/')) continue;
      globalBibliography = file;
      break;
    }
  } catch {}
  let globalCsl = undefined;

  // Para type author con variante completa: usar assembleAuthorExportVariants.
  let rawExportDoc: ExportDocument | null;
  if (targetDoc.type === 'author' && isCompleto) {
    const fileDocs = renderedMap.get('file') ?? [];
    const { full } = assembleAuthorExportVariants(targetDoc, [...fileDocs], lang, cwd, globalBibliography, globalCsl);
    rawExportDoc = full;
  } else {
    let items: BuildDocument[] = [];
    let partGroups: ExportCollectionPart[] = [];
    if (targetDoc.type === 'collection') {
      items = resolveItemsForExport(targetDoc, itemPool);
      partGroups = resolvePartsForExport(targetDoc, itemPool);
    } else if (targetDoc.type === 'events') {
      items = resolveEventsForExport(targetDoc, eventPool);
    }
    const loosePaths = targetDoc.type === 'collection' ? resolveLooseItemPaths(targetDoc) : undefined;
    rawExportDoc = assembleExportDocument(
      targetDoc,
      items,
      lang,
      cwd,
      globalBibliography,
      globalCsl,
      partGroups.length > 0 ? partGroups : undefined,
      config.pdf,
      loosePaths,
    );
  }
  if (!rawExportDoc) return null;

  // Hook beforeExport.
  let exportDoc = rawExportDoc;
  if (registry) {
    const beforeCtx = await registry.runBeforeExport({
      sourcePath: rawExportDoc.filePath,
      body: rawExportDoc.body,
      metadata: rawExportDoc.metadata as unknown as Record<string, unknown>,
    });
    exportDoc = {
      ...rawExportDoc,
      body: beforeCtx.body,
      metadata: {
        ...rawExportDoc.metadata,
        ...(beforeCtx.metadata as Partial<ExportMetadata>),
      },
    };
  }

  const outputPath = `${exportOutputBase(exportDoc, outputDir)}.pdf`;

  // Adquirir semáforo antes de invocar pdflatex para limitar instancias concurrentes.
  // Varias peticiones HTTP simultáneas (pestañas, prefetch) podrían saturar CPU/RAM
  // sin esta limitación.
  const maxSlots = Number.isInteger(config.pdf.concurrency) && config.pdf.concurrency >= 1 ? config.pdf.concurrency : 1;
  await acquireOnDemandLatex(maxSlots);
  let pdfGenerated = false;
  try {
    await convertToPdf(exportDoc, outputPath, cwd, config.pdf);
    pdfGenerated = true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[serve] Error generando PDF bajo demanda ${pdfRelPath}: ${msg}\n`);
  } finally {
    releaseOnDemandLatex();
  }
  if (!pdfGenerated) return null;

  // Hook afterExport.
  if (registry) {
    const pdfData = await Bun.file(outputPath).arrayBuffer();
    const afterCtx = await registry.runAfterExport({
      sourcePath: exportDoc.filePath,
      format: 'pdf',
      data: new Uint8Array(pdfData),
    });
    await Bun.write(outputPath, afterCtx.data);
  }

  return outputPath;
}
