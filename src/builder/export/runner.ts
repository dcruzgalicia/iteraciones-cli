import { join } from 'node:path';
import type { CacheManager } from '../../cache/cache-manager.js';
import { hash } from '../../cache/hasher.js';
import type { ExportConfig } from '../../config/site-config.js';
import { mapWithConcurrency } from '../../output/concurrency.js';
import { convertToEpub, convertToPdf } from '../../services/pandoc-exporter.js';
import type { BuildDocument, DocumentType } from '../types.js';
import { assembleExportDocument, resolveEventsForExport, resolveItemsForExport } from './assemble.js';
import type { ExportResult } from './types.js';
import { EXPORTABLE_TYPES } from './types.js';

export interface ExportRunOptions {
  config: ExportConfig;
  outputDir: string;
  lang: string;
  concurrency: number;
  /** Versión del CLI para la clave de caché. */
  cliVersion: string;
  /** Versión de pandoc para la clave de caché. */
  pandocVersion: string;
  cacheManager?: CacheManager;
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
  const { config, outputDir, lang, concurrency, cliVersion, pandocVersion, cacheManager } = options;

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

    const exportDoc = assembleExportDocument(doc, items, lang);
    if (!exportDoc) return null;

    const outputBase = join(outputDir, exportDoc.relativePath.replace(/\.md$/, ''));
    const result: ExportResult = {
      filePath: exportDoc.filePath,
      relativePath: exportDoc.relativePath,
    };

    for (const format of config.formats) {
      const outputPath = `${outputBase}.${format}`;

      if (format === 'epub') {
        // Para colecciones: incluir hashes de todos los items en la clave (igual que PDF)
        const itemHashes = items.map((i) => i.sourceHash).join('\0');
        const cacheKey = hash(doc.sourceHash, itemHashes, 'epub', cliVersion, pandocVersion);
        if (cacheManager && (await cacheManager.hasBinary('export', cacheKey, 'epub'))) {
          await cacheManager.copyBinaryTo('export', cacheKey, 'epub', outputPath);
          result.epubPath = outputPath;
          continue;
        }
        await convertToEpub(exportDoc, outputPath);
        if (cacheManager) {
          const data = await Bun.file(outputPath).arrayBuffer();
          await cacheManager.writeBinary('export', cacheKey, 'epub', data);
        }
        result.epubPath = outputPath;
      } else if (format === 'pdf') {
        // Para colecciones: incluir hashes de todos los items en la clave
        const itemHashes = items.map((i) => i.sourceHash).join('\0');
        const cacheKey = hash(doc.sourceHash, itemHashes, 'pdf', config.pdfEngine, cliVersion, pandocVersion);
        if (cacheManager && (await cacheManager.hasBinary('export', cacheKey, 'pdf'))) {
          await cacheManager.copyBinaryTo('export', cacheKey, 'pdf', outputPath);
          result.pdfPath = outputPath;
          continue;
        }
        await convertToPdf(exportDoc, outputPath, config.pdfEngine);
        if (cacheManager) {
          const data = await Bun.file(outputPath).arrayBuffer();
          await cacheManager.writeBinary('export', cacheKey, 'pdf', data);
        }
        result.pdfPath = outputPath;
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
