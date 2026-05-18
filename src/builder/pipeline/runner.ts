import type { PluginRegistry } from '../../plugin/registry.js';
import type { TemplateContext } from '../../template/render/context.js';
import type { AuthorDocumentIndex, BuildContext, BuildDocument, DocumentType } from '../types.js';
import type { RenderCache, RenderStats } from './render.js';
import { renderDocuments } from './render.js';
import { TYPE_STAGES } from './type-graph.js';

export interface ContextPhaseResult {
  /** Docs con templateContext construido, listos para compose. */
  allContextDocs: BuildDocument[];
  /**
   * Mapa de todos los docs renderizados por tipo (primarios + index).
   * Usado por runFinalization para calcular las claves de poda de la caché de render.
   */
  renderedMap: Map<DocumentType, BuildDocument[]>;
}

/**
 * Procesa todos los tipos del type-graph usando su TypeStageSpec.
 *
 * - Para tipos 'primary': ya están renderizados en `primaryRendered`; solo construye
 *   el contexto de páginas llamando a `spec.buildPageContexts`.
 * - Para tipos 'index': renderiza los docs con Pandoc, almacena en `renderedMap`,
 *   construye el pool con `spec.buildPool(renderedMap)` y llama a `spec.buildPageContexts`.
 *
 * El orden de TYPE_STAGES determina el orden de procesamiento. `list` debe ser el
 * último tipo index porque su pool incluye todos los tipos anteriores (self-inclusive).
 *
 * @param allDocs       Pool completo de docs activos (sin borradores, kind != 'block' se filtra aquí).
 * @param primaryRendered  Mapa ya poblado con los renders primarios (file, author, event).
 */
export async function runContextPhaseWithTypeGraph(
  allDocs: BuildDocument[],
  ctx: BuildContext,
  renderCache: RenderCache | undefined,
  registry: PluginRegistry,
  siteCtx: TemplateContext,
  primaryRendered: ReadonlyMap<DocumentType, BuildDocument[]>,
  authorIndex: AuthorDocumentIndex,
  renderStats?: RenderStats,
): Promise<ContextPhaseResult> {
  const renderedMap = new Map<DocumentType, BuildDocument[]>(primaryRendered);
  const allContextDocs: BuildDocument[] = [];
  const { listItemsLimit } = ctx.siteConfig;
  const concurrency = ctx.concurrency ?? 4;

  for (const spec of TYPE_STAGES) {
    if (spec.phase === 'primary') {
      // Ya renderizados; solo construir contextos de páginas.
      const rendered = renderedMap.get(spec.type) ?? [];
      const pool = spec.buildPool(renderedMap);
      const contextDocs = rendered.flatMap((doc) => spec.buildPageContexts(doc, siteCtx, pool, authorIndex, listItemsLimit));
      allContextDocs.push(...contextDocs);
    } else {
      // Fase index: renderizar → registrar en mapa → construir pool → construir contextos.
      const docs = allDocs.filter((d) => d.type === spec.type && d.kind !== 'block');
      const rendered = await renderDocuments(docs, concurrency, renderCache, registry, renderStats);
      renderedMap.set(spec.type, rendered);
      const pool = spec.buildPool(renderedMap);
      const contextDocs = rendered.flatMap((doc) => spec.buildPageContexts(doc, siteCtx, pool, authorIndex, listItemsLimit));
      allContextDocs.push(...contextDocs);
    }
  }

  return { allContextDocs, renderedMap };
}
