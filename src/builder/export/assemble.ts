import { dirname, join, resolve } from 'node:path';
import type { PdfFormatConfig } from '../../config/site-config.js';
import type { CollectionItem } from '../../loader/frontmatter.js';
import type { BuildDocument, DocumentType } from '../types.js';
import {
  EXPORTABLE_TYPES,
  type ExportableDocumentType,
  type ExportCollectionPart,
  type ExportDocument,
  type ExportMetadata,
  LATEX_CLASS,
} from './types.js';

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
 * Para tipos scrbook (collection, events): concatena los items como secciones,
 * con el author como heading (\part o \chapter), el title como \section,
 * y el body con offset +2.
 *
 * @param doc                 Documento a exportar.
 * @param items               Items resueltos del documento (solo relevante para collection/events).
 * @param lang                Idioma del sitio para el YAML header.
 * @param cwd                 Directorio raíz del proyecto; usado para validar rutas editoriales.
 * @param globalBibliography  Ruta absoluta al .bib global del sitio (fallback si el frontmatter no define uno).
 * @param globalCsl           Ruta absoluta al .csl global del sitio (fallback si el frontmatter no define uno).
 */
export function assembleExportDocument(
  doc: BuildDocument,
  items: BuildDocument[],
  lang: string,
  cwd: string,
  globalBibliography?: string,
  globalCsl?: string,
  parts?: ExportCollectionPart[],
  pdfFormat?: PdfFormatConfig,
  loosePaths?: string[],
): ExportDocument | null {
  if (!doc.type || !EXPORTABLE_TYPES.has(doc.type)) return null;

  const rawEditorial =
    typeof doc.frontmatter['editorial'] === 'object' && doc.frontmatter['editorial'] !== null
      ? (doc.frontmatter['editorial'] as Record<string, unknown>)
      : {};

  const rawFormatPdf =
    typeof doc.frontmatter['format'] === 'object' && doc.frontmatter['format'] !== null
      ? ((doc.frontmatter['format'] as Record<string, unknown>)['pdf'] as Record<string, unknown> | undefined)
      : undefined;
  const perFileDocClass =
    rawFormatPdf !== undefined && typeof rawFormatPdf['documentclass'] === 'string' && rawFormatPdf['documentclass'] === 'scrartcl'
      ? 'scrartcl'
      : undefined;
  const documentclass = perFileDocClass ?? pdfFormat?.documentclass ?? LATEX_CLASS[doc.type as keyof typeof LATEX_CLASS];
  if (!documentclass) return null;

  // Resolver bibliografía y CSL: editorial.bibliography → export.bibliography → APA 7 por defecto
  const bibliography =
    typeof rawEditorial['bibliography'] === 'string'
      ? safeEditorialPath(rawEditorial['bibliography'], cwd, 'editorial.bibliography')
      : globalBibliography;
  const csl =
    typeof rawEditorial['csl'] === 'string'
      ? safeEditorialPath(rawEditorial['csl'], cwd, 'editorial.csl')
      : (globalCsl ?? (bibliography ? join(import.meta.dir, '../../../pandoc/csl/apa-7.csl') : undefined));

  const tocDepth = pdfFormat?.tocDepth;
  const toc = pdfFormat?.toc ?? (tocDepth !== undefined ? tocDepth > 0 : documentclass === 'scrbook');

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
    toc,
    tocDepth: tocDepth ?? undefined,
    abstract: typeof rawEditorial['abstract'] === 'string' && rawEditorial['abstract'].trim() ? rawEditorial['abstract'].trim() : undefined,
    keywords: Array.isArray(rawEditorial['keywords'])
      ? (rawEditorial['keywords'] as unknown[]).filter((k): k is string => typeof k === 'string')
      : undefined,
  };

  let body = documentclass === 'scrartcl' ? doc.body : assembleBookBody(doc, items, parts, loosePaths);

  // Verificar si el cuerpo contiene texto antes del primer encabezado.
  // Ese texto (preámbulo) hace que LaTeX genere una entrada fantasma en el
  // índice con un asterisco, incluso con secnumdepth=-2.
  // La solución es reubicar ese texto dentro de la primera sección.
  // Comandos LaTeX como \part{} y \addpart{} NO se consideran preámbulo
  // (son encabezados reales en la salida final).
  if (toc) {
    const headingMatch = body.match(/^#{1,6}\s/m);
    const partMatch = body.match(/^\\(add)?part\{/m);
    if (!headingMatch) {
      // Sin encabezados: desactivar el TOC por completo.
      metadata.toc = false;
    } else if (headingMatch.index && headingMatch.index > 0) {
      // Si todo el texto previo al primer # es solo comandos LaTeX
      // (\part{}, \addpart{}, \standalonepart{}, \chapter{}), no moverlo
      // — forma parte de la estructura.
      const preamble = body.slice(0, headingMatch.index).trim();
      const preambleIsOnlyLatexCommands =
        preamble.length === 0 ||
        /^\\((add)?part|standalonepart|containerpart|chapterauthor|chapter)\{/.test(preamble) ||
        /^\\invisiblechapter/.test(preamble);
      if (!preambleIsOnlyLatexCommands) {
        const rest = body.slice(headingMatch.index);
        body = rest + '\n\n' + preamble;
      }
    }
  }

  return {
    filePath: doc.filePath,
    relativePath: doc.relativePath,
    type: doc.type as ExportableDocumentType,
    body,
    metadata,
    slug: doc.slug,
  };
}

/**
 * Ensambla el body de un documento scrbook (collection o events) concatenando
 * los items en orden editorial.
 *
 * Cada item contribuye con:
 *   \standalonepart{\textsc{Author}}  │  (standalone part file)
 *   \chapterauthor{\textsc{Author}}    │  (container / loose)
 *   ## Title                          →  \section
 *   [body del item con offset +2]
 *   \cleardoublepage
 *
 * En standalone part files se inserta un \cleardoublepage extra entre
 * el título \section y el body, para que la primera página del contenido
 * quede en una página nueva.
 */
/**
 * Construye un mapa filePath → showAuthor a partir de los rawItems del frontmatter
 * de una colección, para usar en exportación. Por defecto es `true`.
 */
function buildShowAuthorExportMap(rawItems: CollectionItem[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const item of rawItems) {
    if (typeof item === 'object' && 'file' in item && typeof item.file === 'string') {
      map.set(item.file, item.author !== false);
    } else if (typeof item === 'object' && 'items' in item) {
      for (const subItem of item.items) {
        if (typeof subItem === 'object' && 'file' in subItem && typeof subItem.file === 'string') {
          map.set(subItem.file, subItem.author !== false);
        }
      }
    }
  }
  return map;
}

function assembleBookBody(doc: BuildDocument, items: BuildDocument[], parts?: ExportCollectionPart[], loosePaths?: string[]): string {
  const result: string[] = [];
  const showAuthorMap = buildShowAuthorExportMap(doc.frontmatter.items);

  // Intro opcional de la colección/eventos (body propio del doc index)
  if (doc.body.trim()) {
    result.push(doc.body.trim(), '\n\n');
  }

  if (parts && parts.length > 0) {
    const byPath = new Map<string, BuildDocument>(items.map((d) => [d.relativePath, d]));

    // Items sueltos (prólogo, prefacio, etc.) — antes de cualquier parte
    if (loosePaths) {
      for (const itemPath of loosePaths) {
        const item = byPath.get(itemPath);
        if (item) appendItemBody(item, result, 'loose', showAuthorMap.get(itemPath));
      }
    }

    for (const part of parts) {
      if (part.kind === 'container') {
        result.push(`\\containerpart{${part.name}}\n\n`);
        for (const item of part.items) {
          appendItemBody(item, result, 'container', showAuthorMap.get(item.relativePath));
        }
      } else {
        // Standalone part file
        const standaloneItem = part.items[0];
        if (standaloneItem) appendItemBody(standaloneItem, result, 'standalone-file', showAuthorMap.get(standaloneItem.relativePath));
      }
    }
  } else {
    // Sin partes: author → \chapter{}, title → \section{}, body offset +2
    for (const item of items) {
      appendItemBody(item, result, 'loose', showAuthorMap.get(item.relativePath));
    }
  }

  return result.join('');
}

type ItemPartKind = 'standalone-file' | 'container' | 'loose';

function appendItemBody(item: BuildDocument, target: string[], partKind: ItemPartKind, showAuthor?: boolean): void {
  const authors = item.frontmatter.author;
  const slug = pathToSlug(item.relativePath);
  const title = item.frontmatter.title || 'Sin título';
  const showAuthorLine = showAuthor !== false && authors.length > 0;

  if (partKind === 'standalone-file') {
    if (showAuthorLine) {
      target.push(`\\standalonepart{\\textsc{${authors.join(', ')}}}\n\n`);
      target.push(`## ${title}\n\n`);
    } else {
      target.push(`\\part{${title}}\n\n`);
    }
    target.push('\\thispagestyle{empty}\n\\cleardoublepage\n\\thispagestyle{plain}\n\n');
  } else {
    if (showAuthorLine) {
      target.push(`\\chapterauthor{\\textsc{${authors.join(', ')}}}\n\n`);
    } else {
      target.push(`\\invisiblechapter\n\n`);
    }
    target.push(`## ${title}\n\n`);
  }

  const renamedBody = renameFootnotes(item.body, slug);
  const resolvedBody = resolveImagePaths(renamedBody, item.filePath);
  const shiftedBody = shiftHeadings(resolvedBody, 2);
  const bodyStart = shiftedBody.trim();
  if (bodyStart.startsWith('#')) {
    target.push(bodyStart, '\n\n\\cleardoublepage\n\n');
  } else {
    target.push('\\noindent ', bodyStart, '\n\n\\cleardoublepage\n\n');
  }
}

/**
 * Desplaza los niveles de encabezados ATX (#, ##, ###) en un bloque de
 * markdown. No modifica encabezados dentro de bloques de código delimitados
 * por triple backtick.
 *
 * @param body   Texto markdown a modificar.
 * @param levels Cuántos niveles subir (0 = sin cambios, 1 = # → ##, etc.).
 * @returns      Markdown con los encabezados desplazados, capados a nivel 6.
 */
export function shiftHeadings(body: string, levels: number): string {
  if (levels === 0) return body;

  // Dividir en segmentos: fuera / dentro de code fence
  const segments = body.split(/(```[\s\S]*?```)/g);
  return segments
    .map((segment, i) => {
      // Los segmentos impares son bloques de código — no modificarlos
      if (i % 2 === 1) return segment;
      return segment.replace(/^(#{1,6})(?=\s|$)/gm, (_match, hashes: string) => {
        const newLevel = Math.min(hashes.length + levels, 6);
        return '#'.repeat(newLevel);
      });
    })
    .join('');
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

function collectItemPaths(items: CollectionItem[]): string[] {
  const paths: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      paths.push(item);
    } else if ('file' in item && typeof item.file === 'string') {
      paths.push(item.file);
    } else if ('items' in item) {
      paths.push(...collectItemPaths(item.items));
    }
  }
  return paths;
}

export function resolveLooseItemPaths(doc: BuildDocument): string[] {
  if (doc.type !== 'collection') return [];
  const paths: string[] = [];
  for (const item of doc.frontmatter.items) {
    if (typeof item === 'string') {
      paths.push(item);
    } else if ('file' in item && typeof item.file === 'string' && !('title' in item) && !item.part) {
      paths.push(item.file);
    }
  }
  return paths;
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
  const itemPaths = collectItemPaths(doc.frontmatter.items);
  return itemPaths.map((itemPath) => byPath.get(itemPath)).filter((d): d is BuildDocument => d !== undefined);
}

export function resolvePartsForExport(doc: BuildDocument, pool: BuildDocument[]): ExportCollectionPart[] {
  if (doc.type !== 'collection') return [];
  const byPath = new Map<string, BuildDocument>(pool.map((d) => [d.relativePath, d]));
  const parts: ExportCollectionPart[] = [];

  for (const item of doc.frontmatter.items) {
    if (typeof item === 'object' && 'title' in item && 'items' in item) {
      // Part container
      const resolvedItems = collectItemPaths(item.items)
        .map((p) => byPath.get(p))
        .filter((d): d is BuildDocument => d !== undefined);
      if (resolvedItems.length > 0) {
        parts.push({
          name: item.title,
          items: resolvedItems,
          kind: 'container',
          childCount: resolvedItems.length,
        });
      }
    } else if (typeof item === 'object' && 'file' in item && typeof item.file === 'string' && item.part) {
      // Standalone part file
      const doc = byPath.get(item.file);
      if (doc) {
        parts.push({
          name: doc.frontmatter.title,
          items: [doc],
          kind: 'standalone-file',
          childCount: 0,
          isPartFile: true,
        });
      }
    }
  }

  return parts;
}

/**
 * Resuelve los items de un documento `events`: todos los docs de tipo `event`
 * del pool, sin orden específico (el export los incluye en el orden del pool).
 */
export function resolveEventsForExport(_doc: BuildDocument, eventPool: BuildDocument[]): BuildDocument[] {
  return eventPool;
}

// ─── Helpers para exportación de author ──────────────────────────────────────

function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Construye el cuerpo markdown para exportación de un documento de tipo `author`.
 *
 * Incluye todos los campos del perfil (tagline, contacto, skills, training,
 * interests, languages, bio) y la sección Trayectoria con el nivel de detalle
 * definido por `variant`:
 *   - 'summary': título, fecha y abstract de cada obra
 *   - 'full': título, fecha, abstract, body completo y keywords de cada obra
 */
function buildAuthorExportBody(doc: BuildDocument, sortedWorks: BuildDocument[], variant: 'summary' | 'full'): string {
  const parts: string[] = [];
  const fm = doc.frontmatter;

  // Contacto / datos de contexto
  const contactLines: string[] = [];
  if (fm.tagline) contactLines.push(`*${fm.tagline}*`);
  if (fm.location) contactLines.push(`**Ubicación:** ${fm.location}`);
  if (fm.email) contactLines.push(`**Correo:** ${fm.email}`);
  if (fm.links && fm.links.length > 0) {
    for (const l of fm.links) {
      contactLines.push(`**${l.label}:** <${l.url}>`);
    }
  }
  if (contactLines.length > 0) {
    parts.push(`::: {.authorcontact}\n${contactLines.join('\\\n')}\n:::`);
    parts.push('\n\n');
  }

  if (fm.skills && fm.skills.length > 0) {
    parts.push(`## Skills\n\n${fm.skills.join(', ')}\n\n`);
  }
  if (fm.training && fm.training.length > 0) {
    parts.push(`## Formación\n\n${fm.training.map((t) => `- ${t}`).join('\n')}\n\n`);
  }
  if (fm.interests && fm.interests.length > 0) {
    parts.push(`## Intereses\n\n${fm.interests.join(', ')}\n\n`);
  }
  if (fm.languages && fm.languages.length > 0) {
    parts.push(`## Idiomas\n\n${fm.languages.map((l) => `- ${l}`).join('\n')}\n\n`);
  }

  // Bio (perfil)
  if (doc.body.trim()) {
    parts.push(`## Perfil\n\n${doc.body.trim()}\n\n`);
  }

  // Trayectoria
  if (sortedWorks.length > 0) {
    parts.push('## Trayectoria\n\n');
    for (const work of sortedWorks) {
      const date = work.frontmatter.date ? ` (${work.frontmatter.date})` : '';
      parts.push(`### ${work.frontmatter.title}${date}\n\n`);
      if (work.frontmatter.abstract) {
        const abstract = variant === 'full' ? `*${work.frontmatter.abstract}*` : work.frontmatter.abstract;
        parts.push(`${abstract}\n\n`);
      }
      if (variant === 'full') {
        if (work.body.trim()) {
          parts.push(`${work.body.trim()}\n\n`);
        }
        if (work.frontmatter.keywords.length > 0) {
          parts.push(`**Keywords:** ${work.frontmatter.keywords.join(', ')}\n\n`);
        }
        parts.push('---\n\n');
      }
    }
  }

  return parts.join('');
}

/**
 * Ensambla las dos variantes de exportación para un documento de tipo `author`.
 *
 * Variante 'summary' → `nombre.pdf/epub`:
 *   Perfil completo + trayectoria con título/fecha/abstract.
 *
 * Variante 'full' → `nombre-completo.pdf/epub`:
 *   Perfil completo + trayectoria con body completo y keywords de cada obra.
 *
 * @param doc       Documento autor (tipo 'author').
 * @param fileDocs  Todos los docs tipo 'file' del renderedMap (sin filtrar).
 * @param lang      Idioma del sitio.
 * @param cwd       Directorio raíz del proyecto.
 */
export function assembleAuthorExportVariants(
  doc: BuildDocument,
  fileDocs: BuildDocument[],
  lang: string,
  cwd: string,
  globalBibliography?: string,
  globalCsl?: string,
): { summary: ExportDocument; full: ExportDocument } {
  const rawEditorial =
    typeof doc.frontmatter['editorial'] === 'object' && doc.frontmatter['editorial'] !== null
      ? (doc.frontmatter['editorial'] as Record<string, unknown>)
      : {};

  // Resolver bibliografía y CSL: editorial.bibliography → export.bibliography → APA 7 por defecto
  const bibliography =
    typeof rawEditorial['bibliography'] === 'string'
      ? safeEditorialPath(rawEditorial['bibliography'], cwd, 'editorial.bibliography')
      : globalBibliography;
  const csl =
    typeof rawEditorial['csl'] === 'string'
      ? safeEditorialPath(rawEditorial['csl'], cwd, 'editorial.csl')
      : (globalCsl ?? (bibliography ? join(import.meta.dir, '../../../pandoc/csl/apa-7.csl') : undefined));

  const rawFormatPdf =
    typeof doc.frontmatter['format'] === 'object' && doc.frontmatter['format'] !== null
      ? ((doc.frontmatter['format'] as Record<string, unknown>)['pdf'] as Record<string, unknown> | undefined)
      : undefined;
  const perFileDocClass =
    rawFormatPdf !== undefined && typeof rawFormatPdf['documentclass'] === 'string' && rawFormatPdf['documentclass'] === 'scrartcl'
      ? 'scrartcl'
      : undefined;

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
    documentclass: perFileDocClass ?? LATEX_CLASS.author,
    toc: false,
    abstract: typeof rawEditorial['abstract'] === 'string' && rawEditorial['abstract'].trim() ? rawEditorial['abstract'].trim() : undefined,
    keywords: undefined,
  };

  // Resolver y ordenar las obras del autor por fecha descendente
  const authorName = normalizeForComparison(doc.frontmatter.title);
  const authorWorks = authorName
    ? fileDocs
        .filter((f) => f.kind !== 'block' && f.frontmatter.author.some((a) => normalizeForComparison(a) === authorName))
        .sort((a, b) => {
          if (a.frontmatter.date > b.frontmatter.date) return -1;
          if (a.frontmatter.date < b.frontmatter.date) return 1;
          return 0;
        })
    : [];

  return {
    summary: {
      filePath: doc.filePath,
      relativePath: doc.relativePath,
      type: 'author' as const,
      body: buildAuthorExportBody(doc, authorWorks, 'summary'),
      metadata,
      slug: doc.slug,
    },
    full: {
      filePath: doc.filePath,
      relativePath: doc.relativePath.replace(/\.md$/, '-completo.md'),
      type: 'author' as const,
      body: buildAuthorExportBody(doc, authorWorks, 'full'),
      metadata,
      slug: doc.slug ? `${doc.slug}-completo` : undefined,
    },
  };
}
