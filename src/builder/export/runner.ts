import { join, resolve } from 'node:path';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import type { ExportConfig } from '../../config/site-config.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import type { PluginRegistry } from '../../plugin/registry.js';
import { convertToEpub, convertToPdf } from '../../services/pandoc-exporter.js';
import type { BuildDocument, DocumentType } from '../types.js';
import { assembleExportDocument, resolveEventsForExport, resolveItemsForExport } from './assemble.js';
import type { ExportMetadata, ExportResult } from './types.js';
import { EXPORTABLE_TYPES } from './types.js';

export interface ExportRunOptions {
  config: ExportConfig;
  outputDir: string;
  /** Directorio raíz del proyecto; usado para validar rutas editoriales (cover, bibliography, csl) y para resolver rutas globales de ExportConfig. */
  cwd: string;
  lang: string;
  /**
   * Número máximo de documentos que se exportan en paralelo.
   * Dentro de cada documento, los formatos (PDF/EPUB) se generan simultáneamente
   * de forma independiente, por lo que el número real de procesos pandoc puede ser
   * hasta `concurrency × formats.length`.
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
export async function runExportDocuments(
  renderedMap: ReadonlyMap<DocumentType, BuildDocument[]>,
  options: ExportRunOptions,
): Promise<ExportResult[]> {
  const { config, outputDir, cwd, lang, concurrency, cliVersion, pandocVersion, cacheManager, registry, pluginFingerprint, stats } = options;

  // Resolver y validar rutas globales de bibliography y csl desde ExportConfig.
  // Las rutas vienen de _iteraciones.yaml (confiables), pero igualmente se verifica
  // que queden dentro del proyecto para ser consistentes con la validación de frontmatter.
  // resolve() normaliza siempre: elimina '..', resuelve rutas relativas y absolutas.
  const resolveGlobalPath = (raw: string | undefined, field: string): string | undefined => {
    if (!raw) return undefined;
    // resolve() normaliza siempre: elimina '..', maneja rutas relativas y absolutas.
    // Una ruta absoluta con '..' como '/project/../etc/passwd' queda normalizada a '/etc/passwd',
    // que luego falla el startsWith y se descarta correctamente.
    const resolved = resolve(cwd, raw);
    if (!resolved.startsWith(cwd + '/') && resolved !== cwd) {
      process.stderr.write(`[export] export.${field}: ruta fuera del proyecto ignorada: "${raw}"\n`);
      return undefined;
    }
    return resolved;
  };
  const globalBibliography = resolveGlobalPath(config.bibliography, 'bibliography');
  const globalCsl = resolveGlobalPath(config.csl, 'csl');

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
    let items: BuildDocument[] = [];
    if (doc.type === 'collection') {
      items = resolveItemsForExport(doc, itemPool);
    } else if (doc.type === 'events') {
      items = resolveEventsForExport(doc, eventPool);
    }

    const rawExportDoc = assembleExportDocument(doc, items, lang, cwd, globalBibliography, globalCsl, config.template);
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

    const outputBase = join(outputDir, exportDoc.relativePath.replace(/\.md$/, ''));
    // Hash de items pre-computado una sola vez: compartido por todos los formatos
    // del documento. Evita la duplicación del cálculo que había en el loop secuencial.
    const itemHashes = items.map((i) => i.sourceHash).join('\0');

    // Generar todos los formatos en paralelo: PDF y EPUB son completamente
    // independientes para el mismo documento y no comparten estado de escritura.
    // Promise.allSettled garantiza que ambos formatos terminan (éxito o error)
    // antes de propagar el primer error, de modo que no quedan promesas en vuelo
    // cuando la función retorna o lanza. No evita que un formato escriba en caché
    // aunque el otro falle después.
    const formatResults = await Promise.allSettled(
      config.formats.map(async (format): Promise<{ epub?: string; pdf?: string }> => {
        const outputPath = `${outputBase}.${format}`;

        if (format === 'epub') {
          const cacheKey = hash(doc.sourceHash, itemHashes, 'epub', cliVersion, pandocVersion, pluginFingerprint ?? '', bibHash, cslHash);
          if (cacheManager && (await cacheManager.hasBinary('export', cacheKey, 'epub'))) {
            await cacheManager.copyBinaryTo('export', cacheKey, 'epub', outputPath);
            if (stats) {
              stats.totalEpub++;
              stats.cacheHitsEpub++;
            }
            return { epub: outputPath };
          }
          await convertToEpub(exportDoc, outputPath);
          // Hook afterExport: permite post-procesar los bytes del archivo generado.
          const epubData = await Bun.file(outputPath).arrayBuffer();
          if (registry) {
            const afterCtx = await registry.runAfterExport({ sourcePath: exportDoc.filePath, format: 'epub', data: new Uint8Array(epubData) });
            await Bun.write(outputPath, afterCtx.data);
            // .slice() normaliza el buffer: evita que un Uint8Array con byteOffset
            // o longitud parcial escriba bytes extra o incorrectos en la caché.
            if (cacheManager) await cacheManager.writeBinary('export', cacheKey, 'epub', afterCtx.data.slice().buffer as ArrayBuffer);
          } else if (cacheManager) {
            await cacheManager.writeBinary('export', cacheKey, 'epub', epubData);
          }
          if (stats) stats.totalEpub++;
          return { epub: outputPath };
        }

        if (format === 'pdf') {
          const cacheKey = hash(
            doc.sourceHash,
            itemHashes,
            'pdf',
            config.pdfEngine,
            cliVersion,
            pandocVersion,
            pluginFingerprint ?? '',
            bibHash,
            cslHash,
          );
          if (cacheManager && (await cacheManager.hasBinary('export', cacheKey, 'pdf'))) {
            await cacheManager.copyBinaryTo('export', cacheKey, 'pdf', outputPath);
            if (stats) {
              stats.totalPdf++;
              stats.cacheHitsPdf++;
            }
            return { pdf: outputPath };
          }
          await convertToPdf(exportDoc, outputPath, config.pdfEngine);
          // Hook afterExport: permite post-procesar los bytes del archivo generado.
          const pdfData = await Bun.file(outputPath).arrayBuffer();
          if (registry) {
            const afterCtx = await registry.runAfterExport({ sourcePath: exportDoc.filePath, format: 'pdf', data: new Uint8Array(pdfData) });
            await Bun.write(outputPath, afterCtx.data);
            // .slice() normaliza el buffer: evita que un Uint8Array con byteOffset
            // o longitud parcial escriba bytes extra o incorrectos en la caché.
            if (cacheManager) await cacheManager.writeBinary('export', cacheKey, 'pdf', afterCtx.data.slice().buffer as ArrayBuffer);
          } else if (cacheManager) {
            await cacheManager.writeBinary('export', cacheKey, 'pdf', pdfData);
          }
          if (stats) stats.totalPdf++;
          return { pdf: outputPath };
        }

        return {};
      }),
    );

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
    if (Object.keys(extra).length === 0) return doc;
    return { ...doc, templateContext: { ...doc.templateContext, ...extra } };
  });
}
