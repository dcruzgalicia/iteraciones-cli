import type { TemplateContext } from '../../template/render/context.js';
import { escapeHtml } from '../html.js';
import type { AuthorDocumentIndex, BuildDocument } from '../types.js';

/**
 * Normaliza un string para comparación: minúsculas, sin espacios extra.
 */
function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resuelve el href root-relative del primer autor del array que tenga un documento
 * en el índice. Devuelve `undefined` si no hay índice o ningún autor tiene página.
 */
export function resolveAuthorHref(authors: string[], index: AuthorDocumentIndex | undefined): string | undefined {
  if (!index) return undefined;
  for (const name of authors) {
    const doc = index.get(normalizeForComparison(name));
    if (doc) return `/${doc.relativePath.replace(/\.md$/, '.html')}`;
  }
  return undefined;
}

/**
 * Construye el TemplateContext para un documento de tipo `author`.
 *
 * Variables producidas para `templates/author.html`:
 *   title      → frontmatter.title del documento autor
 *   pagetitle  → frontmatter.title del documento autor
 *   author     → frontmatter.author del documento autor (unido con ', ')
 *   body       → htmlFragment del documento autor (bio opcional)
 *   list-items → publicaciones (tipo 'file') cuyo frontmatter.author incluye el título del autor: { href, title, author, body: '' (shadow), date, abstract? }
 *   count      → número de publicaciones
 *   tagline    → frontmatter.tagline del documento autor
 *   location   → frontmatter.location del documento autor
 *   email      → frontmatter.email del documento autor
 *   links      → frontmatter.links del documento autor
 *   skills     → frontmatter.skills del documento autor (array de strings)
 *   training   → frontmatter.training del documento autor (array de strings)
 *   interests  → frontmatter.interests del documento autor (array de strings)
 *   languages  → frontmatter.languages del documento autor (array de strings)
 *
 * La coincidencia es case-insensitive: se compara cada nombre en el array author
 * con el título del documento autor.
 */
export function buildAuthorContext(doc: BuildDocument, fileDocs: BuildDocument[], paginationCtx?: Record<string, unknown>): TemplateContext {
  const authorName = normalizeForComparison(doc.frontmatter.title);

  const matched = authorName ? fileDocs.filter((file) => file.frontmatter.author.some((a) => normalizeForComparison(a) === authorName)) : [];

  const listItems = matched.map((file) => ({
    href: `/${file.relativePath.replace(/\.md$/, '.html')}`,
    title: file.frontmatter.title,
    author: file.frontmatter.author.join(', '),
    body: '',
    date: file.frontmatter.date,
    ...(file.frontmatter.abstract !== undefined && { abstract: file.frontmatter.abstract }),
  }));

  const tagline = doc.frontmatter.tagline;
  const location = doc.frontmatter.location;
  const email = doc.frontmatter.email;
  const links = doc.frontmatter.links;
  const skills = doc.frontmatter.skills;
  const training = doc.frontmatter.training;
  const interests = doc.frontmatter.interests;
  const languages = doc.frontmatter.languages;
  const hasContact = location !== undefined || email !== undefined || (links !== undefined && links.length > 0);

  return {
    title: doc.frontmatter.title,
    pagetitle: escapeHtml(doc.frontmatter.title),
    author: doc.frontmatter.author.join(', '),
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    count: listItems.length,
    ...(tagline !== undefined && { tagline }),
    ...(location !== undefined && { location }),
    ...(email !== undefined && { email }),
    ...(links !== undefined && { links }),
    ...(skills !== undefined && { skills }),
    ...(training !== undefined && { training }),
    ...(interests !== undefined && { interests }),
    ...(languages !== undefined && { languages }),
    ...(hasContact && { 'has-contact': true }),
    ...paginationCtx,
  };
}

/**
 * Construye el TemplateContext para un documento de tipo `authors`.
 *
 * Variables producidas para `templates/authors.html`:
 *   title     → frontmatter.title del documento índice
 *   pagetitle → frontmatter.title del documento índice
 *   body      → htmlFragment del documento índice (introducción opcional)
 *   authors   → array de { href, title, body, abstract?, keywords? } por cada documento de tipo 'author'
 *   count     → número de autores
 */
export function buildAuthorsContext(doc: BuildDocument, authorDocs: BuildDocument[], paginationCtx?: Record<string, unknown>): TemplateContext {
  const authors = authorDocs.map((authorDoc) => ({
    href: `/${authorDoc.relativePath.replace(/\.md$/, '.html')}`,
    title: authorDoc.frontmatter.title,
    body: authorDoc.htmlFragment ?? '',
    ...(authorDoc.frontmatter.abstract !== undefined && { abstract: authorDoc.frontmatter.abstract }),
    ...(authorDoc.frontmatter.keywords.length > 0 && { keywords: authorDoc.frontmatter.keywords }),
  }));

  return {
    title: doc.frontmatter.title,
    pagetitle: escapeHtml(doc.frontmatter.title),
    body: doc.htmlFragment ?? '',
    authors,
    count: authors.length,
    ...paginationCtx,
  };
}

/**
 * Construye un índice de documentos de tipo `author` indexados por su título
 * normalizado (lowercase, trimmed). Primer documento autor con ese título "gana"
 * si hubiera duplicados.
 *
 * Precondición: `renderedAuthorDocs` solo contiene documentos tipo 'author'
 * con `kind !== 'block'` ya renderizados (htmlFragment disponible).
 */
export function createAuthorDocumentIndex(renderedAuthorDocs: BuildDocument[]): AuthorDocumentIndex {
  const index = new Map<string, BuildDocument>();
  for (const doc of renderedAuthorDocs) {
    const key = normalizeForComparison(doc.frontmatter.title);
    if (key && !index.has(key)) {
      index.set(key, doc);
    }
  }
  return index;
}

/**
 * Construye el fragmento de contexto `{ 'sidebar-authors' }` para el slot de autores
 * relacionados en sidebar-primary. Para cada nombre en `doc.frontmatter.author`,
 * busca el documento autor en el índice y devuelve tarjetas con href, title y body.
 *
 * Devuelve `{}` si el documento no tiene autores o ninguno está en el índice.
 * El href generado es root-relative (prefijo /).
 */
export function buildRelatedAuthorsContext(doc: BuildDocument, authorIndex: AuthorDocumentIndex): TemplateContext {
  if (doc.frontmatter.author.length === 0) return {};

  const authors = doc.frontmatter.author
    .map((name) => authorIndex.get(normalizeForComparison(name)))
    .filter((a): a is BuildDocument => a !== undefined && a.relativePath !== doc.relativePath)
    .map((authorDoc) => ({
      href: `/${authorDoc.relativePath.replace(/\.md$/, '.html')}`,
      title: authorDoc.frontmatter.title,
      body: authorDoc.htmlFragment ?? '',
    }));

  return authors.length > 0 ? { 'sidebar-authors': authors } : {};
}
