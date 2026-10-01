import { formatHumanDate } from '../../lib/date.js';
import type { BuildDocument } from '../types.js';
import type { ExportDocument, ExportMetadata } from './types.js';

export function assembleExportDocument(
  doc: BuildDocument,
  language: string,
  globalBibliography?: string,
  globalCsl?: string,
  toc?: boolean,
): ExportDocument {
  const metadata: ExportMetadata = {
    title: doc.frontmatter.title || 'Sin título',
    creator: doc.frontmatter.creator,
    date: formatHumanDate(doc.frontmatter.date) ?? undefined,
    dateIso: doc.frontmatter.date,
    language,
    bibliography: globalBibliography,
    csl: globalCsl,
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
