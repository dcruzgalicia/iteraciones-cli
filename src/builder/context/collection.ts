import type { CollectionItem } from '../../loader/frontmatter.js';
import type { TemplateContext } from '../../template/render/context.js';
import { escapeHtml } from '../html.js';
import { docHref } from '../slug.js';
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
  rawItems?: CollectionItem[],
  allDocs?: BuildDocument[],
): TemplateContext {
  const byPath = new Map<string, BuildDocument>(items.map((d) => [d.relativePath, d]));

  const listItems = items.map((item) => itemToTemplateItem(item, authorIndex));

  // Construir parts y loose-items desde el nuevo schema unificado
  // Iteración ordenada única que preserva la intercalación original entre
  // part containers, standalone part files y loose items.
  const hasParts = rawItems && rawItems.length > 0 && allDocs;
  let partsData: PartGroupTemplate[] | undefined;
  let looseItemsData: PartGroupTemplateItem[] | undefined;

  if (hasParts) {
    const partsArray: PartGroupTemplate[] = [];
    const looseArray: PartGroupTemplateItem[] = [];

    for (const item of rawItems!) {
      if (typeof item === 'string') {
        const doc = byPath.get(item);
        if (doc) looseArray.push(itemToTemplateItem(doc, authorIndex));
      } else if ('title' in item && 'items' in item) {
        const resolvedItems = collectSubPaths(item.items)
          .map((p) => byPath.get(p))
          .filter((d): d is BuildDocument => d !== undefined)
          .map((doc) => itemToTemplateItem(doc, authorIndex));
        partsArray.push({ name: item.title, items: resolvedItems });
      } else if ('file' in item && typeof item.file === 'string' && item.part) {
        const doc = byPath.get(item.file);
        if (doc) {
          partsArray.push({ name: doc.frontmatter.title, items: [itemToTemplateItem(doc, authorIndex)] });
        }
      } else if ('file' in item && typeof item.file === 'string') {
        const doc = byPath.get(item.file);
        if (doc) looseArray.push(itemToTemplateItem(doc, authorIndex));
      }
    }

    partsData = partsArray.length > 0 ? partsArray : undefined;
    looseItemsData = looseArray.length > 0 ? looseArray : undefined;
  }

  return {
    title: doc.frontmatter.title,
    pagetitle: escapeHtml(doc.frontmatter.title),
    author: doc.frontmatter.author.join(', '),
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    ...(looseItemsData !== undefined && { 'loose-items': looseItemsData }),
    ...(partsData !== undefined && { parts: partsData }),
    count: listItems.length,
    ...(paginationCtx ?? {}),
  };
}

function itemToTemplateItem(item: BuildDocument, authorIndex?: AuthorDocumentIndex): PartGroupTemplateItem {
  const authorHref = resolveAuthorHref(item.frontmatter.author, authorIndex);
  return {
    href: docHref(item),
    title: item.frontmatter.title,
    author: item.frontmatter.author.join(', '),
    'author-href': authorHref,
    date: item.frontmatter.date,
    ...(item.frontmatter.abstract !== undefined && { abstract: item.frontmatter.abstract }),
    ...(item.frontmatter.keywords.length > 0 && { keywords: item.frontmatter.keywords }),
  };
}

function collectSubPaths(items: CollectionItem[]): string[] {
  const paths: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      paths.push(item);
    } else if ('file' in item && typeof item.file === 'string') {
      paths.push(item.file);
    } else if ('items' in item) {
      paths.push(...collectSubPaths(item.items));
    }
  }
  return paths;
}
