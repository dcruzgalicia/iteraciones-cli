import type { TemplateContext } from '../../template/render/context.js';
import type { BuildDocument } from '../types.js';

/**
 * Normaliza un string para comparación: minúsculas, sin espacios extra.
 * Devuelve '' si el valor es undefined o vacío.
 */
function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/**
 * Construye el TemplateContext para un documento de tipo `author`.
 *
 * Variables producidas para `templates/author.html`:
 *   title      → frontmatter.title del documento autor
 *   pagetitle  → frontmatter.title del documento autor
 *   author     → frontmatter.author del documento autor
 *   body       → htmlFragment del documento autor (bio opcional)
 *   list-items → publicaciones (tipo 'file') cuyo frontmatter.author coincide con el título del autor
 *   count      → número de publicaciones
 *
 * La coincidencia es case-insensitive sobre el campo `author` del documento file.
 */
export function buildAuthorContext(doc: BuildDocument, fileDocs: BuildDocument[]): TemplateContext {
  const authorName = normalize(doc.frontmatter.title);

  const matched = authorName ? fileDocs.filter((file) => normalize(file.frontmatter.author) === authorName) : [];

  const listItems = matched.map((file) => ({
    href: file.relativePath.replace(/\.md$/, '.html'),
    title: file.frontmatter.title,
    author: file.frontmatter.author,
    date: file.frontmatter.date,
  }));

  return {
    title: doc.frontmatter.title,
    pagetitle: doc.frontmatter.title,
    author: doc.frontmatter.author,
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
