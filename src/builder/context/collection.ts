import type { CollectionPart } from '../../loader/frontmatter.js';
import type { TemplateContext } from '../../template/render/context.js';
import { escapeHtml } from '../html.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';
import { resolveAuthorHref } from './authors.js';

interface PartGroupTemplateItem {
  href: string;
  title: string;
  author: string;
  'author-href'?: string;
  date: string;
  abstract?: string;
  keywords?: string[];
}

interface PartGroupTemplate {
  name: string;
  items: PartGroupTemplateItem[];
}

/**
 * Construye el TemplateContext para un documento de tipo `collection`.
 *
 * Variables producidas para `templates/collection.html`:
 *   title         → frontmatter.title del documento colección
 *   author        → frontmatter.author del documento colección
 *   body          → htmlFragment del documento colección (introducción opcional)
 *   list-items    → array de { href, title, author, author-href?, date, abstract?, keywords? }
 *                   — todos los items planos (retrocompat: cuando no hay `parts:`).
 *   loose-items   → (opcional) array de items sueltos antes de la primera parte.
 *   parts         → (opcional) array de { name, items } para colecciones agrupadas en partes.
 *   count         → número de items en esta página.
 *
 * Variables de paginación (presentes si `paginationCtx` se proporciona):
 *   has-pagination  → true cuando hay más de una página
 *   page-number     → número de página actual (base 1)
 *   page-count      → total de páginas
 *   total-items     → total de items en la colección
 *   page-previous   → { href } si existe página anterior, undefined si no
 *   page-next       → { href } si existe página siguiente, undefined si no
 *
 * Precondición: `items` ya han sido resueltos por `resolveCollectionItems` (búsqueda
 * por ruta en el pool) y paginados por `paginateItems`; el orden editorial de `items:`
 * en el frontmatter se preserva sin reordenar por fecha.
 */
export function buildCollectionContext(
  doc: BuildDocument,
  items: BuildDocument[],
  authorIndex?: AuthorDocumentIndex,
  paginationCtx?: Record<string, unknown>,
  parts?: CollectionPart[],
  allDocs?: BuildDocument[],
): TemplateContext {
  const byPath = new Map<string, BuildDocument>(items.map((d) => [d.relativePath, d]));

  const listItems = items.map((item) => itemToTemplateItem(item, authorIndex));

  const hasParts = parts && parts.length > 0 && allDocs;
  const partsData = hasParts ? buildPartsContext(parts!, allDocs!, authorIndex) : undefined;

  // Items sueltos (de items: plano) solo cuando conviven con partes
  const looseItems = hasParts
    ? doc.frontmatter.items
        .map((p) => byPath.get(p))
        .filter((d): d is BuildDocument => d !== undefined)
        .map((item) => itemToTemplateItem(item, authorIndex))
    : undefined;

  return {
    title: doc.frontmatter.title,
    pagetitle: escapeHtml(doc.frontmatter.title),
    author: doc.frontmatter.author.join(', '),
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    ...(looseItems !== undefined && { 'loose-items': looseItems }),
    ...(partsData !== undefined && { parts: partsData }),
    count: listItems.length,
    ...(paginationCtx ?? {}),
  };
}

function itemToTemplateItem(item: BuildDocument, authorIndex?: AuthorDocumentIndex): PartGroupTemplateItem {
  const authorHref = resolveAuthorHref(item.frontmatter.author, authorIndex);
  return {
    href: `/${item.relativePath.replace(/\.md$/, '.html')}`,
    title: item.frontmatter.title,
    author: item.frontmatter.author.join(', '),
    'author-href': authorHref,
    date: item.frontmatter.date,
    ...(item.frontmatter.abstract !== undefined && { abstract: item.frontmatter.abstract }),
    ...(item.frontmatter.keywords.length > 0 && { keywords: item.frontmatter.keywords }),
  };
}

function buildPartsContext(rawParts: CollectionPart[], allDocs: BuildDocument[], authorIndex?: AuthorDocumentIndex): PartGroupTemplate[] {
  const byPath = new Map<string, BuildDocument>(allDocs.map((d) => [d.relativePath, d]));
  return rawParts.map((part) => ({
    name: part.name,
    items: part.items
      .map((itemPath) => byPath.get(itemPath))
      .filter((d): d is BuildDocument => d !== undefined)
      .map((item) => itemToTemplateItem(item, authorIndex)),
  }));
}
