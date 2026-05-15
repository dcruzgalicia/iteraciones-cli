import type { TemplateContext } from '../../template/render/context.js';
import type { BuildDocument } from '../types.js';

/**
 * Normaliza un string para comparación: minúsculas, sin espacios extra.
 * Devuelve '' si el valor es undefined o vacío.
 */
function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Construye el TemplateContext para un documento de tipo `author`.
 *
 * Variables producidas para `templates/author.html`:
 *   title      → frontmatter.title del documento autor
 *   pagetitle  → frontmatter.title del documento autor
 *   author     → frontmatter.author del documento autor (unido con ', ')
 *   body       → htmlFragment del documento autor (bio opcional)
 *   list-items → publicaciones (tipo 'file') cuyo frontmatter.author incluye el título del autor
 *   count      → número de publicaciones
 *
 * La coincidencia es case-insensitive: se compara cada nombre en el array author
 * con el título del documento autor.
 */
export function buildAuthorContext(doc: BuildDocument, fileDocs: BuildDocument[]): TemplateContext {
  const authorName = normalizeForComparison(doc.frontmatter.title);

  const matched = authorName ? fileDocs.filter((file) => file.frontmatter.author.some((a) => normalizeForComparison(a) === authorName)) : [];

  const listItems = matched.map((file) => ({
    href: file.relativePath.replace(/\.md$/, '.html'),
    title: file.frontmatter.title,
    author: file.frontmatter.author.join(', '),
    date: file.frontmatter.date,
  }));

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    author: doc.frontmatter.author.join(', '),
    body: doc.htmlFragment ?? '',
    'list-items': listItems,
    count: listItems.length,
  };
}

/**
 * Construye el TemplateContext para un documento de tipo `authors`.
 *
 * Variables producidas para `templates/authors.html`:
 *   title     → frontmatter.title del documento índice
 *   pagetitle → frontmatter.title del documento índice
 *   body      → htmlFragment del documento índice (introducción opcional)
 *   authors   → array de { href, title, body } por cada documento de tipo 'author'
 *   count     → número de autores
 */
export function buildAuthorsContext(doc: BuildDocument, authorDocs: BuildDocument[]): TemplateContext {
  const authors = authorDocs.map((authorDoc) => ({
    href: authorDoc.relativePath.replace(/\.md$/, '.html'),
    title: authorDoc.frontmatter.title,
    body: authorDoc.htmlFragment ?? '',
  }));

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    body: doc.htmlFragment ?? '',
    authors,
    count: authors.length,
  };
}
