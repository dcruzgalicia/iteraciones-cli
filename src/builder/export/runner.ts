import { stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import type { ExportConfig } from '../../config/site-config.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import { convertToEpub, convertToPdf } from '../../services/pandoc-exporter.js';
import type { BuildDocument, DocumentType } from '../types.js';
import {
  assembleAuthorExportVariants,
  assembleExportDocument,
  resolveEventsForExport,
  resolveItemsForExport,
  resolvePartsForExport,
} from './assemble.js';
import type { ExportCollectionPart, ExportDocument, ExportMetadata, ExportResult } from './types.js';
import { EXPORTABLE_TYPES } from './types.js';

/**
 * Genera una imagen de portada JPG a partir de la primera página de un PDF.
 * Usa `pdftoppm` (parte de poppler-utils). Si no está disponible o falla, retorna undefined.
 *
 * @param pdfPath   Ruta absoluta al PDF fuente.
 * @param outputBase Ruta base de salida sin extensión (ej: /dist/web/notas/foo).
 *                   pdftoppm produce `<outputBase>.jpg`.
 * @returns Ruta absoluta al JPG generado, o undefined si falló.
 */
async function generateCoverImage(pdfPath: string, outputBase: string): Promise<string | undefined> {
  try {
    const coverPath = `${outputBase}.jpg`;
    // Reutilizar la imagen si ya existe y es más reciente que el PDF fuente.
    const [coverStat, pdfStat] = await Promise.all([stat(coverPath).catch(() => null), stat(pdfPath)]);
    if (coverStat && coverStat.mtimeMs >= pdfStat.mtimeMs) return coverPath;
    const proc = Bun.spawn(['pdftoppm', '-r', '150', '-jpeg', '-singlefile', pdfPath, outputBase], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) return undefined;
    const exists = await Bun.file(coverPath).exists();
    return exists ? coverPath : undefined;
  } catch {
    // pdftoppm no instalado o no disponible en PATH — no es error fatal
    return undefined;
  }
}

export interface ExportRunOptions {
  config: ExportConfig;
  outputDir: string;
  /** Directorio raíz del proyecto; usado para validar rutas editoriales (cover, bibliography, csl) y para resolver rutas globales de ExportConfig. */
  cwd: string;
  lang: string;
  /**
   * Número máximo de documentos que se procesan en paralelo en el outer loop.
   * Cuando la exportación incluye PDF, un semáforo interno limita las instancias
   * xelatex activas simultáneamente a `config.pdfConcurrency`; `concurrency` sigue
   * siendo el límite de documentos en vuelo (incluidos los que esperan el semáforo).
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
  cacheHitsEpub: number;
  cacheHitsPdf: number;
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
// Limita las instancias xelatex lanzadas desde exportSingleDocument cuando el
// usuario abre múltiples PDFs en simultáneo (pestañas, prefetch, recargas).
// Se inicializa con el primer valor de pdfConcurrency que recibe; si cambia
// en recargas posteriores del config, el valor inicial sigue vigente.
let _onDemandXelatexSlots = -1;
const _onDemandXelatexQueue: Array<() => void> = [];

function acquireOnDemandXelatex(maxSlots: number): Promise<void> {
  if (_onDemandXelatexSlots < 0) _onDemandXelatexSlots = maxSlots;
  return new Promise<void>((res) => {
    if (_onDemandXelatexSlots > 0) {
      _onDemandXelatexSlots--;
      res();
    } else {
      _onDemandXelatexQueue.push(res);
    }
  });
}

function releaseOnDemandXelatex(): void {
  const next = _onDemandXelatexQueue.shift();
  if (next) {
    next();
  } else {
    _onDemandXelatexSlots++;
  }
}

export async function runExportDocuments(
  renderedMap: ReadonlyMap<DocumentType, BuildDocument[]>,
  options: ExportRunOptions,
): Promise<ExportResult[]> {
  const { config, outputDir, cwd, lang, concurrency, cliVersion, pandocVersion, cacheManager, registry, pluginFingerprint, stats } = options;

  const hasPdf = config.formats.includes('pdf');
  // Semáforo interno que limita las instancias xelatex concurrentes sin afectar EPUB.
  // El outer mapWithConcurrency usa el límite general (concurrency); dentro del branch
  // PDF se adquiere un slot antes de invocar xelatex y se libera al terminar — con o
  // sin error. Así el número de documentos en vuelo es `concurrency`, pero las llamadas
  // a xelatex activas simultáneamente se acotan a `pdfConcurrency` (~300-600 MB/proceso).
  let xelatexSlots = hasPdf ? (Number.isInteger(config.pdfConcurrency) && config.pdfConcurrency >= 1 ? config.pdfConcurrency : 1) : 0;
  const xelatexQueue: Array<() => void> = [];
  const acquireXelatex = (): Promise<void> =>
    new Promise<void>((res) => {
      if (xelatexSlots > 0) {
        xelatexSlots--;
        res();
      } else {
        xelatexQueue.push(res);
      }
    });
  const releaseXelatex = (): void => {
    const next = xelatexQueue.shift();
    if (next) {
      next();
    } else {
      xelatexSlots++;
    }
  };

  // Resolver y validar rutas globales de bibliography y csl desde ExportConfig.
  // Las rutas vienen de _iteraciones.yaml (confiables), pero igualmente se verifica
  // que queden dentro del proyecto para ser consistentes con la validación de frontmatter.
  const globalBibliography = resolveExportGlobalPath(config.bibliography, cwd, 'bibliography');
  const globalCsl = resolveExportGlobalPath(config.csl, cwd, 'csl');

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
    for await (const f of new Bun.Glob('*.latex').scan({ cwd: EXPORT_TEMPLATES_DIR })) {
      tplFiles.push(f);
    }
    for await (const f of new Bun.Glob('*.css').scan({ cwd: EXPORT_TEMPLATES_DIR })) {
      tplFiles.push(f);
    }
    tplFiles.sort(); // orden determinístico para un hash estable
    for (const filename of tplFiles) {
      tplHasher.update(await Bun.file(join(EXPORT_TEMPLATES_DIR, filename)).text());
      tplHasher.update('\0');
    }
    // Incluir las fuentes TTF: PDF las usa vía fontspec y EPUB las embebe.
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

  /**
   * Convierte el primer autor en un slug seguro para nombre de archivo.
   * Retorna el slug seguido de un guion, o cadena vacía si no hay autores.
   */
  function authorSlug(authors: string[]): string {
    if (authors.length === 0) return '';
    const name = (authors[0] ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    return name ? `${name}-` : '';
  }

  // Closure que genera los formatos (epub, pdf) para un ExportDocument ya ensamblado.
  // `sourceHash` es el hash del documento fuente original (para la clave de caché).
  // `itemHashes` es la cadena de hashes de los ítems incluidos (string vacío para
  // documentos sin ítems como author).
  async function generateFormats(
    exportDoc: ExportDocument,
    outputBase: string,
    sourceHash: string,
    itemHashes: string,
  ): Promise<Array<PromiseSettledResult<{ epub?: string; pdf?: string }>>> {
    return Promise.allSettled(
      config.formats.map(async (format): Promise<{ epub?: string; pdf?: string }> => {
        const outputPath = `${outputBase}.${format}`;

        if (format === 'epub') {
          const cacheKey = hash(sourceHash, itemHashes, 'epub', cliVersion, pandocVersion, pluginFingerprint ?? '', bibHash, cslHash, templateHash);
          if (cacheManager && (await cacheManager.hasBinary('export', cacheKey, 'epub'))) {
            await cacheManager.copyBinaryTo('export', cacheKey, 'epub', outputPath);
            if (stats) {
              stats.totalEpub++;
              stats.cacheHitsEpub++;
            }
            return { epub: outputPath };
          }
          await convertToEpub(exportDoc, outputPath, cwd, config.layout?.pdf);
          // Hook afterExport: permite post-procesar los bytes del archivo generado.
          const epubData = await Bun.file(outputPath).arrayBuffer();
          if (registry) {
            const afterCtx = await registry.runAfterExport({ sourcePath: exportDoc.filePath, format: 'epub', data: new Uint8Array(epubData) });
            await Bun.write(outputPath, afterCtx.data);
            if (cacheManager) await cacheManager.writeBinary('export', cacheKey, 'epub', afterCtx.data.slice().buffer as ArrayBuffer);
          } else if (cacheManager) {
            await cacheManager.writeBinary('export', cacheKey, 'epub', epubData);
          }
          if (stats) stats.totalEpub++;
          return { epub: outputPath };
        }

        if (format === 'pdf') {
          const cacheKey = hash(
            sourceHash,
            itemHashes,
            'pdf',
            config.pdfEngine,
            cliVersion,
            pandocVersion,
            pluginFingerprint ?? '',
            bibHash,
            cslHash,
            templateHash,
          );
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
          await acquireXelatex();
          try {
            await convertToPdf(exportDoc, outputPath, config.pdfEngine, cwd, config.layout?.pdf, config.hyphenation?.pdf);
          } finally {
            releaseXelatex();
          }
          // Hook afterExport: permite post-procesar los bytes del archivo generado.
          const pdfData = await Bun.file(outputPath).arrayBuffer();
          if (registry) {
            const afterCtx = await registry.runAfterExport({ sourcePath: exportDoc.filePath, format: 'pdf', data: new Uint8Array(pdfData) });
            await Bun.write(outputPath, afterCtx.data);
            if (cacheManager) await cacheManager.writeBinary('export', cacheKey, 'pdf', afterCtx.data.slice().buffer as ArrayBuffer);
          } else if (cacheManager) {
            await cacheManager.writeBinary('export', cacheKey, 'pdf', pdfData);
          }
          if (stats) stats.totalPdf++;
          pdfDone++;
          options.onExportProgress?.(exportDoc.relativePath, false);
          return { pdf: outputPath };
        }

        return {};
      }),
    );
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
        summaryDoc = { ...rawSummary, body: sBefore.body, metadata: { ...rawSummary.metadata, ...(sBefore.metadata as Partial<ExportMetadata>) } };
        fullDoc = { ...rawFull, body: fBefore.body, metadata: { ...rawFull.metadata, ...(fBefore.metadata as Partial<ExportMetadata>) } };
      }

      const summaryBase = join(outputDir, summaryDoc.relativePath.replace(/\.md$/, ''));
      const fullBase = join(outputDir, fullDoc.relativePath.replace(/\.md$/, ''));

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

      const result: ExportResult = { filePath: doc.filePath, relativePath: doc.relativePath };
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
      if (result.pdfPath) result.coverPath = await generateCoverImage(result.pdfPath, summaryBase);
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

    const rawExportDoc = assembleExportDocument(
      doc,
      items,
      lang,
      cwd,
      globalBibliography,
      globalCsl,
      partGroups.length > 0 ? partGroups : undefined,
      config.layout?.pdf,
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
        metadata: { ...rawExportDoc.metadata, ...(beforeCtx.metadata as Partial<ExportMetadata>) },
      };
    }

    const authorPrefix = authorSlug(exportDoc.metadata.author);
    const outputBase = authorPrefix
      ? join(outputDir, dirname(exportDoc.relativePath), `${authorPrefix}${basename(exportDoc.relativePath, '.md')}`)
      : join(outputDir, exportDoc.relativePath.replace(/\.md$/, ''));
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
      } else if (!firstError) {
        firstError = fr.reason;
      }
    }
    if (firstError) throw firstError;
    // Generar imagen de portada a partir del PDF si se produjo uno.
    if (result.pdfPath) {
      result.coverPath = await generateCoverImage(result.pdfPath, outputBase);
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
    const href = `/${doc.relativePath.replace(/\.md$/, '.html')}`;
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
    return { ...doc, templateContext: { ...doc.templateContext, 'list-items': updatedItems } };
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
    const href = `/${doc.relativePath.replace(/\.md$/, '.html')}`;
    coverByHref.set(href, cover);
  }
  if (coverByHref.size === 0) return docs;
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
      const cover = coverByHref.get(href);
      if (!cover) return item;
      changed = true;
      return { ...itemObj, 'cover-image': cover };
    });
    if (!changed) return doc;
    return { ...doc, templateContext: { ...doc.templateContext, 'list-items': updatedItems } };
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

  if (!config.formats.includes('pdf')) return null;

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

  // Resolver rutas globales de bibliography y csl (reutiliza el helper compartido, con aviso).
  const globalBibliography = resolveExportGlobalPath(config.bibliography, cwd, 'bibliography');
  const globalCsl = resolveExportGlobalPath(config.csl, cwd, 'csl');

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
    rawExportDoc = assembleExportDocument(
      targetDoc,
      items,
      lang,
      cwd,
      globalBibliography,
      globalCsl,
      partGroups.length > 0 ? partGroups : undefined,
      config.layout?.pdf,
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
      metadata: { ...rawExportDoc.metadata, ...(beforeCtx.metadata as Partial<ExportMetadata>) },
    };
  }

  const outputPath = join(outputDir, exportDoc.relativePath.replace(/\.md$/, '.pdf'));

  // Adquirir semáforo antes de invocar xelatex para limitar instancias concurrentes.
  // Varias peticiones HTTP simultáneas (pestañas, prefetch) podrían saturar CPU/RAM
  // sin esta limitación.
  const maxSlots = Number.isInteger(config.pdfConcurrency) && config.pdfConcurrency >= 1 ? config.pdfConcurrency : 1;
  await acquireOnDemandXelatex(maxSlots);
  let pdfGenerated = false;
  try {
    await convertToPdf(exportDoc, outputPath, config.pdfEngine, cwd, config.layout?.pdf, config.hyphenation?.pdf);
    pdfGenerated = true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[serve] Error generando PDF bajo demanda ${pdfRelPath}: ${msg}\n`);
  } finally {
    releaseOnDemandXelatex();
  }
  if (!pdfGenerated) return null;

  // Hook afterExport.
  if (registry) {
    const pdfData = await Bun.file(outputPath).arrayBuffer();
    const afterCtx = await registry.runAfterExport({ sourcePath: exportDoc.filePath, format: 'pdf', data: new Uint8Array(pdfData) });
    await Bun.write(outputPath, afterCtx.data);
  }

  return outputPath;
}
