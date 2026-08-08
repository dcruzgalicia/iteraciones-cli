import { join } from 'node:path';
import { formatHumanDate } from '../../lib/date.js';
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
  toc?: boolean,
): ExportDocument {
  const documentclass: 'scrartcl' | 'scrbook' = 'scrbook';

  const bibliography = globalBibliography;
  const csl = globalCsl ?? (bibliography ? join(import.meta.dir, '../../../src/lib/resources/apa-7.csl') : undefined);

  const metadata: ExportMetadata = {
    title: doc.frontmatter.title || 'Sin título',
    author: doc.frontmatter.author,
    date: formatHumanDate(doc.frontmatter.date) ?? undefined,
    lang,
    bibliography,
    csl,
    documentclass,
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
