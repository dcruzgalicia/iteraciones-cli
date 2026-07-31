import { dirname, join, resolve } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';
import { logWarning } from '../../lib/logger.js';
import type { BuildDocument } from '../types.js';
import type { ExportDocument, ExportMetadata } from './types.js';

function safeEditorialPath(rawPath: string, cwd: string, fieldName: string): string | undefined {
  const resolved = resolve(cwd, rawPath);
  if (!resolved.startsWith(cwd + '/') && resolved !== cwd) {
    logWarning(`campo '${fieldName}' con ruta fuera del proyecto ignorado: "${rawPath}"`, 'export');
    return undefined;
  }
  return resolved;
}

/**
 * Ensambla un ExportDocument a partir de un BuildDocument.
 * El body se toma de processedBody (LaTeX) sin modificaciones.
 */
export function assembleExportDocument(
  doc: BuildDocument,
  lang: string,
  cwd: string,
  globalBibliography?: string,
  globalCsl?: string,
  pdfFormat?: PdfFormatConfig,
): ExportDocument | null {
  if (!doc.processedBody) return null;

  const rawEditorial =
    typeof doc.frontmatter['editorial'] === 'object' && doc.frontmatter['editorial'] !== null
      ? (doc.frontmatter['editorial'] as Record<string, unknown>)
      : {};

  const documentclass = pdfFormat?.documentclass?.class ?? 'scrbook';
  if (!documentclass) return null;

  const bibliography =
    typeof rawEditorial['bibliography'] === 'string'
      ? safeEditorialPath(rawEditorial['bibliography'], cwd, 'editorial.bibliography')
      : globalBibliography;
  const csl =
    typeof rawEditorial['csl'] === 'string'
      ? safeEditorialPath(rawEditorial['csl'], cwd, 'editorial.csl')
      : (globalCsl ?? (bibliography ? join(import.meta.dir, '../../../src/lib/resources/apa-7.csl') : undefined));

  const metadata: ExportMetadata = {
    title: doc.frontmatter.title || 'Sin título',
    author: doc.frontmatter.author,
    date: doc.frontmatter.date || undefined,
    lang,
    isbn: typeof rawEditorial['isbn'] === 'string' ? rawEditorial['isbn'] : undefined,
    publisher: typeof rawEditorial['publisher'] === 'string' ? rawEditorial['publisher'] : undefined,
    description: typeof rawEditorial['description'] === 'string' ? rawEditorial['description'] : undefined,
    rights: typeof rawEditorial['rights'] === 'string' ? rawEditorial['rights'] : undefined,
    cover: typeof rawEditorial['cover'] === 'string' ? safeEditorialPath(rawEditorial['cover'], cwd, 'editorial.cover') : undefined,
    bibliography,
    csl,
    documentclass,
    toc: pdfFormat?.toc ?? false,
    tocDepth: pdfFormat?.setcounter?.tocdepth ?? undefined,
    abstract: typeof rawEditorial['abstract'] === 'string' && rawEditorial['abstract'].trim() ? rawEditorial['abstract'].trim() : undefined,
    keywords: Array.isArray(rawEditorial['keywords'])
      ? (rawEditorial['keywords'] as unknown[]).filter((k): k is string => typeof k === 'string')
      : undefined,
  };

  return {
    filePath: doc.filePath,
    relativePath: doc.relativePath,
    body: doc.processedBody ?? '',
    htmlBody: doc.htmlFragment ?? undefined,
    metadata,
    slug: doc.slug,
  };
}
