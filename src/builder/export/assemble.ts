import { join } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';
import type { BuildDocument } from '../types.js';
import type { ExportDocument, ExportMetadata } from './types.js';

/**
 * Ensambla un ExportDocument a partir de un BuildDocument.
 * Los inputs de conversión (AST/LaTeX/HTML) se leen del caché en disco
 * (`.iteraciones/ast/`, `.iteraciones/tex/`) en el momento de exportar.
 */
export function assembleExportDocument(
  doc: BuildDocument,
  lang: string,
  globalBibliography?: string,
  globalCsl?: string,
  pdfFormat?: PdfFormatConfig,
): ExportDocument {
  const documentclass = pdfFormat?.documentclass?.class ?? 'scrbook';

  const bibliography = globalBibliography;
  const csl = globalCsl ?? (bibliography ? join(import.meta.dir, '../../../src/lib/resources/apa-7.csl') : undefined);

  const metadata: ExportMetadata = {
    title: doc.frontmatter.title || 'Sin título',
    author: doc.frontmatter.author,
    date: doc.frontmatter.date || undefined,
    lang,
    bibliography,
    csl,
    documentclass,
    toc: pdfFormat?.toc ?? false,
    tocDepth: pdfFormat?.setcounter?.tocdepth ?? undefined,
  };

  return {
    filePath: doc.filePath,
    relativePath: doc.relativePath,
    metadata,
    slug: doc.slug,
  };
}
