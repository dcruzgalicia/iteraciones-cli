import { formatHumanDate } from '../../lib/date.js';
import type { BuildDocument } from '../types.js';
import type { ExportDocument, ExportMetadata } from './types.js';

/**
 * Ensambla un ExportDocument a partir de un BuildDocument.
 * Los metadatos provienen del frontmatter del documento y de la config del sitio.
 */
export function assembleExportDocument(
  doc: BuildDocument,
  language: string,
  globalBibliography?: string,
  globalCsl?: string,
  toc?: boolean,
): ExportDocument {
  const bibliography = globalBibliography;
  // Sin fallback al apa-7 del paquete: el export Markdown no debe incrustar
  // rutas internas del paquete en su frontmatter (el CSL empaquetado lo
  // resuelve el pipeline al compilar; el export es portable).
  const csl = globalCsl;

  const metadata: ExportMetadata = {
    title: doc.frontmatter.title || 'Sin título',
    creator: doc.frontmatter.creator,
    date: formatHumanDate(doc.frontmatter.date) ?? undefined,
    dateIso: doc.frontmatter.date,
    language,
    bibliography,
    csl,
    toc: toc ?? false,
    tocDepth: 1,
  };

  return {
    filePath: doc.filePath,
    relativePath: doc.relativePath,
    metadata,
    slug: doc.slug,
  };
}
