/**
 * Renderiza markdown inline a comandos LaTeX.
 *
 * Soporta:
 *   - `**texto**` → `\\textbf{texto}`
 *   - `*texto*`   → `\\textit{texto}`
 *   - `` `codigo` `` → `\\texttt{codigo}`
 *
 * El contenido interno se escapa para LaTeX.
 * El texto fuera de los spans markdown también se escapa.
 */
function renderMarkdownInlineLatex(text: string): string {
  const markers: string[] = [];

  // Negritas: **texto** → \textbf{texto}
  text = text.replace(/\*\*(.+?)\*\*/g, (_match: string, inner: string) => {
    const idx = markers.length;
    markers.push(`\\textbf{${escapeLatex(inner)}}`);
    return `\x00MD${idx}\x00`;
  });

  // Cursivas: *texto* → \textit{texto}
  // Debe ejecutarse después de negritas para no interferir con **
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_match: string, inner: string) => {
    const idx = markers.length;
    markers.push(`\\textit{${escapeLatex(inner)}}`);
    return `\x00MD${idx}\x00`;
  });

  // Código inline: `codigo` → \texttt{codigo}
  text = text.replace(/`([^`]+)`/g, (_match: string, inner: string) => {
    const idx = markers.length;
    markers.push(`\\texttt{${escapeLatex(inner)}}`);
    return `\x00MD${idx}\x00`;
  });

  // Escapar el texto restante
  text = escapeLatex(text);

  // Restaurar placeholders
  for (let i = 0; i < markers.length; i++) {
    const restored = markers[i];
    if (restored !== undefined) {
      text = text.replace(`\x00MD${i}\x00`, restored);
    }
  }

  return text;
}

/**
 * Escapa caracteres especiales de LaTeX.
 * Usa un placeholder para el backslash para que las llaves de
 * \textbackslash{} no se re-escapen.
 */
function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '@@BS@@')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/%/g, '\\%')
    .split('@@BS@@')
    .join('\\textbackslash{}');
}

import { dirname, join, resolve } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';
import { logWarning } from '../../lib/logger.js';
import type { BuildDocument } from '../types.js';
import type { DictumEntry, ExportDocument, ExportMetadata } from './types.js';

/**
 * Parsea el campo `dictum` del frontmatter.
 * Soporta: [{ text: "Cita", author: "Autor" }] o string "Cita\n\nAutor".
 */
function parseDictum(raw: unknown): { dictum?: DictumEntry[] } {
  if (raw === undefined || raw === null) return {};
  if (Array.isArray(raw)) {
    const entries: DictumEntry[] = [];
    for (const item of raw) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if (typeof obj.text === 'string' && obj.text.trim()) {
          const parts = obj.text
            .trim()
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean);

          if (parts.length === 0) continue;
          let text: string;
          let author: string | undefined;
          if (typeof obj.author === 'string' && obj.author.trim()) {
            text = renderMarkdownInlineLatex(parts.join('\n\n'));
            author = renderMarkdownInlineLatex(obj.author.trim());
          } else if (parts.length === 1) {
            text = renderMarkdownInlineLatex(parts[0]!);
          } else {
            text = parts
              .slice(0, -1)
              .map((p) => renderMarkdownInlineLatex(p))
              .join('\n\n');
            author = renderMarkdownInlineLatex(parts[parts.length - 1]!);
          }
          const entry: DictumEntry = { text };
          if (author) entry.author = author;
          entries.push(entry);
        }
      }
    }
    return { dictum: entries.length > 0 ? entries : undefined };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    const parts = trimmed
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return {};
    let text: string;
    let author: string | undefined;
    if (parts.length === 1) {
      text = renderMarkdownInlineLatex(parts[0]!);
    } else {
      text = parts
        .slice(0, -1)
        .map((p) => renderMarkdownInlineLatex(p))
        .join('\n\n');
      author = renderMarkdownInlineLatex(parts[parts.length - 1]!);
    }
    const entry: DictumEntry = { text };
    if (author) entry.author = author;
    return { dictum: [entry] };
  }
  return {};
}

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
    ...parseDictum(doc.frontmatter['dictum']),
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
