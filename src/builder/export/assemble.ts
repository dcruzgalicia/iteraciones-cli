import { dirname, resolve } from 'node:path';
import type { BuildDocument, DocumentType } from '../types.js';
import { EXPORTABLE_TYPES, type ExportDocument, type ExportLatexTemplate, type ExportMetadata, LATEX_CLASS } from './types.js';

/**
 * Resuelve una ruta de archivo editorial (bibliography, csl, cover) y verifica
 * que esté dentro del directorio del proyecto para prevenir path traversal.
 *
 * @param rawPath  Valor crudo del frontmatter (puede ser relativo o absoluto).
 * @param cwd      Directorio raíz del proyecto.
 * @param fieldName  Nombre del campo, solo para el mensaje de warning.
 * @returns Ruta absoluta validada, o undefined si está fuera del proyecto.
 */
function safeEditorialPath(rawPath: string, cwd: string, fieldName: string): string | undefined {
  // resolve() normaliza siempre: elimina '..', resuelve rutas relativas y absolutas.
  // Para una ruta absoluta como '/project/../etc/passwd', resolve() retorna '/etc/passwd',
  // que luego falla el startsWith y se descarta. Usando isAbsolute + sin resolve()
  // esa ruta absoluta con '..' habría pasado la validación.
  const resolved = resolve(cwd, rawPath);
  // Asegurar que la ruta resuelta esté dentro del cwd del proyecto.
  // Previene que frontmatter con '../../../etc/passwd' acceda a rutas del sistema.
  if (!resolved.startsWith(cwd + '/') && resolved !== cwd) {
    process.stderr.write(`[export] campo '${fieldName}' con ruta fuera del proyecto ignorado: "${rawPath}"\n`);
    return undefined;
  }
  return resolved;
}

/**
 * Ensambla un ExportDocument a partir de un BuildDocument.
 *
 * Para tipos scrartcl (file, event, author): retorna el body del documento sin modificar.
 * Para tipos scrbook (collection, events): concatena el body de los items como capítulos,
 * prefijados con `# Título` y (cuando corresponde) `*Por Autor*`.
 *
 * @param doc                 Documento a exportar.
 * @param items               Items resueltos del documento (solo relevante para collection/events).
 * @param lang                Idioma del sitio para el YAML header.
 * @param cwd                 Directorio raíz del proyecto; usado para validar rutas editoriales.
 * @param globalBibliography  Ruta absoluta al .bib global del sitio (fallback si el frontmatter no define uno).
 * @param globalCsl           Ruta absoluta al .csl global del sitio (fallback si el frontmatter no define uno).
 * @param globalTemplate      Variante de template del sitio (fallback si el frontmatter no define `editorial.template`).
 */
export function assembleExportDocument(
  doc: BuildDocument,
  items: BuildDocument[],
  lang: string,
  cwd: string,
  globalBibliography?: string,
  globalCsl?: string,
  globalTemplate?: ExportLatexTemplate,
): ExportDocument | null {
  if (!doc.type || !EXPORTABLE_TYPES.has(doc.type)) return null;

  const documentclass = LATEX_CLASS[doc.type as keyof typeof LATEX_CLASS];
  if (!documentclass) return null;

  const rawEditorial =
    typeof doc.frontmatter['editorial'] === 'object' && doc.frontmatter['editorial'] !== null
      ? (doc.frontmatter['editorial'] as Record<string, unknown>)
      : {};

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
    bibliography:
      typeof rawEditorial['bibliography'] === 'string'
        ? safeEditorialPath(rawEditorial['bibliography'], cwd, 'editorial.bibliography')
        : globalBibliography,
    csl: typeof rawEditorial['csl'] === 'string' ? safeEditorialPath(rawEditorial['csl'], cwd, 'editorial.csl') : globalCsl,
    documentclass,
    toc: documentclass === 'scrbook',
    template: resolveTemplateVariant(rawEditorial['template'], globalTemplate),
    abstract: typeof rawEditorial['abstract'] === 'string' && rawEditorial['abstract'].trim() ? rawEditorial['abstract'].trim() : undefined,
    keywords: Array.isArray(rawEditorial['keywords'])
      ? (rawEditorial['keywords'] as unknown[]).filter((k): k is string => typeof k === 'string')
      : undefined,
  };

  const body = documentclass === 'scrartcl' ? doc.body : assembleBookBody(doc, items);

  return {
    filePath: doc.filePath,
    relativePath: doc.relativePath,
    body,
    metadata,
  };
}

/**
 * Ensambla el body de un documento scrbook (collection o events) concatenando
 * los capítulos de sus items en orden editorial.
 *
 * Cada item contribuye con:
 *   # Título del capítulo
 *   *Por Autor*          ← omitido si el item es de tipo `author` (sería redundante)
 *   [body del item con footnotes renombrados e imágenes con rutas absolutas]
 *   \newpage
 */
function assembleBookBody(doc: BuildDocument, items: BuildDocument[]): string {
  const parts: string[] = [];

  // Intro opcional de la colección/eventos (body propio del doc index)
  if (doc.body.trim()) {
    parts.push(doc.body.trim(), '\n\n');
  }

  for (const item of items) {
    const title = item.frontmatter.title || 'Sin título';
    const authors = item.frontmatter.author;
    const slug = pathToSlug(item.relativePath);

    parts.push(`# ${title}\n\n`);

    // Caso especial: ítems de tipo `author` no llevan línea "Por Autor"
    // porque el título ya es el nombre del autor — sería redundante.
    if (item.type !== 'author' && authors.length > 0) {
      parts.push(`*Por ${authors.join(', ')}*\n\n`);
    }

    const renamedBody = renameFootnotes(item.body, slug);
    const resolvedBody = resolveImagePaths(renamedBody, item.filePath);
    parts.push(resolvedBody.trim(), '\n\n\\newpage\n\n');
  }

  return parts.join('');
}

/**
 * Prefija cada referencia de footnote con el slug del archivo fuente.
 * Evita colisiones de IDs cuando múltiples archivos usan [^1], [^2], etc.
 *
 * Ejemplo: [^1] en "notas/articulo.md" → [^notas-articulo-1]
 */
function renameFootnotes(body: string, slug: string): string {
  return body.replace(/\[\^(\w+)\]/g, `[^${slug}-$1]`);
}

/**
 * Convierte rutas de imágenes relativas en absolutas.
 * Necesario porque al concatenar múltiples archivos, Pandoc resuelve las rutas
 * relativas al directorio de trabajo del proceso, no al archivo fuente original.
 */
function resolveImagePaths(body: string, sourceFilePath: string): string {
  const sourceDir = dirname(sourceFilePath);
  return body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, path: string) => {
    // Solo resolver rutas relativas (que no comienzan con http:// o /)
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
      return `![${alt}](${path})`;
    }
    const absPath = resolve(sourceDir, path);
    return `![${alt}](${absPath})`;
  });
}

/**
 * Convierte una ruta relativa en un slug seguro para usar como prefijo de footnote.
 * Ejemplo: 'notas/mi-articulo.md' → 'notas-mi-articulo'
 */
function pathToSlug(relativePath: string): string {
  return relativePath
    .replace(/\.md$/, '')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-z0-9-]/gi, '');
}

/**
 * Resuelve los items de un documento `collection` buscando cada ruta de
 * `doc.frontmatter.items` en el pool de docs disponibles.
 *
 * La lógica replica `resolveCollectionItems` del context pipeline para mantener
 * consistencia entre el libro exportado y el índice HTML.
 */
export function resolveItemsForExport(doc: BuildDocument, pool: BuildDocument[]): BuildDocument[] {
  if (doc.type !== 'collection') return [];
  const byPath = new Map<string, BuildDocument>(pool.map((d) => [d.relativePath, d]));
  return doc.frontmatter.items.map((itemPath) => byPath.get(itemPath)).filter((d): d is BuildDocument => d !== undefined);
}

/**
 * Resuelve los items de un documento `events`: todos los docs de tipo `event`
 * del pool, sin orden específico (el export los incluye en el orden del pool).
 */
export function resolveEventsForExport(_doc: BuildDocument, eventPool: BuildDocument[]): BuildDocument[] {
  return eventPool;
}

/**
 * Resuelve la variante de template LaTeX a usar, dando prioridad al valor del
 * frontmatter sobre el global del sitio. Retorna el fallback global si el valor
 * del frontmatter no es una variante válida, o `undefined` si tampoco hay fallback.
 */
function resolveTemplateVariant(raw: unknown, globalFallback: ExportLatexTemplate | undefined): ExportLatexTemplate | undefined {
  if (raw === 'literary' || raw === 'academic' || raw === 'anthology' || raw === 'technical') return raw;
  return globalFallback;
}
