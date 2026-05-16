/**
 * Utilidades de paginación para documentos de tipo índice (`list`, `authors`, `events`).
 *
 * La página 1 usa la ruta original del documento (e.g. `lista.md` → `lista.html`).
 * Las páginas siguientes usan una ruta derivada (e.g. `lista/2.md` → `lista/2.html`).
 */

export interface PageInfo {
  /** Número de página actual, 1-indexed. */
  pageNumber: number;
  /** Total de páginas. */
  pageCount: number;
  /** Total de items sin paginar. */
  totalItems: number;
  /** Indica si hay más de una página. */
  hasPagination: boolean;
}

export interface PaginatedPage<T> extends PageInfo {
  /** Items que pertenecen a esta página. */
  items: T[];
  /**
   * `relativePath` que debe usar el `BuildDocument` derivado para esta página.
   * Página 1 mantiene la ruta original; páginas N>1 usan `<base>/N.md`.
   */
  pageRelativePath: string;
}

/**
 * Divide `allItems` en páginas de tamaño `limit` y calcula el `pageRelativePath`
 * de cada página a partir de `baseRelativePath` (e.g. `"lista.md"`).
 *
 * Siempre devuelve al menos una página aunque `allItems` esté vacío.
 */
export function paginateItems<T>(allItems: T[], limit: number, baseRelativePath: string): PaginatedPage<T>[] {
  const total = allItems.length;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const base = baseRelativePath.replace(/\.md$/, '');

  return Array.from({ length: pageCount }, (_, i) => ({
    items: allItems.slice(i * limit, (i + 1) * limit),
    pageNumber: i + 1,
    pageCount,
    totalItems: total,
    hasPagination: pageCount > 1,
    pageRelativePath: i === 0 ? baseRelativePath : `${base}/${i + 1}.md`,
  }));
}

/**
 * Genera el array de hrefs root-relative para cada página de un documento,
 * en el mismo orden que `paginateItems`.
 *
 * Página 1: `/<base>.html`
 * Página N: `/<base>/N.html`
 */
export function buildPageHrefs(baseRelativePath: string, pageCount: number): string[] {
  const base = baseRelativePath.replace(/\.md$/, '');
  return Array.from({ length: pageCount }, (_, i) => (i === 0 ? `/${base}.html` : `/${base}/${i + 1}.html`));
}

/**
 * Construye las variables de contexto de paginación para una página dada.
 * Si `hasPagination` es false, devuelve `{}` (sin variables de paginación).
 *
 * `page-previous` y `page-next` son objetos `{ href }` para compatibilidad
 * con la sintaxis `$page-previous.href$` del motor de templates.
 */
export function buildPaginationContext(page: PageInfo, pageHrefs: string[]): Record<string, unknown> {
  if (!page.hasPagination) return {};

  const prevHref = page.pageNumber > 1 ? pageHrefs[page.pageNumber - 2] : undefined;
  const nextHref = page.pageNumber < page.pageCount ? pageHrefs[page.pageNumber] : undefined;

  return {
    'has-pagination': true,
    'page-number': page.pageNumber,
    'page-count': page.pageCount,
    'total-items': page.totalItems,
    ...(prevHref !== undefined && { 'page-previous': { href: prevHref } }),
    ...(nextHref !== undefined && { 'page-next': { href: nextHref } }),
  };
}
