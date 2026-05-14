import type { TemplateContext } from '../../../template/render/context.js';
import { buildAuthorContext, buildAuthorsContext } from '../../context/authors.js';
import type { BuildDocument, DocumentType } from '../../types.js';
import { mergeContexts } from './merge.js';

/**
 * Construye el TemplateContext completo para un documento de tipo `author`,
 * combinando el contexto del sitio con el contexto de autor.
 *
 * `index` es el resultado de `collectByType`: los items de tipo `'file'`
 * se filtran por coincidencia con el nombre del autor.
 */
export function buildAuthorPipelineContext(doc: BuildDocument, siteCtx: TemplateContext, index: Map<DocumentType, BuildDocument[]>): TemplateContext {
  const fileDocs = index.get('file') ?? [];
  const authorCtx = buildAuthorContext(doc, fileDocs);
  return mergeContexts(siteCtx, authorCtx);
}

/**
 * Construye el TemplateContext completo para un documento de tipo `authors`,
 * combinando el contexto del sitio con el contexto del índice de autores.
 *
 * `index` es el resultado de `collectByType`: los docs de tipo `'author'`
 * se usan para poblar el listado.
 */
export function buildAuthorsPipelineContext(
  doc: BuildDocument,
  siteCtx: TemplateContext,
  index: Map<DocumentType, BuildDocument[]>,
): TemplateContext {
  const authorDocs = index.get('author') ?? [];
  const authorsCtx = buildAuthorsContext(doc, authorDocs);
  return mergeContexts(siteCtx, authorsCtx);
}
