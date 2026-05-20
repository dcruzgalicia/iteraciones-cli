import { buildRelatedAuthorsContext } from '../context/authors.js';
import type { DocumentType } from '../types.js';
import {
  buildAuthorPipelineContext,
  buildAuthorsPipelineContext,
  buildPagedAuthorPipelineContexts,
  buildPagedAuthorsPipelineContexts,
} from './context/authors.js';
import { buildCardPipelineContext } from './context/card.js';
import { buildCollectionPipelineContext, buildPagedCollectionPipelineContexts } from './context/collection.js';
import { buildEventPipelineContext, buildEventsPipelineContext, buildPagedEventsPipelineContexts } from './context/event.js';
import { buildContext } from './context/index.js';
import { buildListPipelineContext, buildPagedListPipelineContexts } from './context/list.js';
import { buildMenuPipelineContext } from './context/menu.js';
import { mergeContexts } from './context/merge.js';
import type { TypeStageSpec } from './stage.js';

/**
 * Grafo de tipos del pipeline: especificaciones de los 9 DocumentType actuales.
 *
 * El orden del array codifica la secuencia de procesamiento dentro de cada fase:
 * - Primarios: file → author → event (en este orden: author necesita file en el pool).
 * - Index: collection → authors → events → menu → card → list
 *   (list debe ir último porque su pool incluye todos los tipos anteriores).
 *
 * @see TypeStageSpec para la descripción de cada campo.
 */
export const TYPE_STAGES: TypeStageSpec[] = [
  // ─── FASE PRIMARY ────────────────────────────────────────────────────────

  {
    type: 'file',
    phase: 'primary',
    canBeBlock: true,
    paginated: false,
    buildPool: () => [],
    buildPageContexts: (doc, siteCtx, _pool, authorIndex) => [
      {
        ...doc,
        templateContext: mergeContexts(buildContext(doc, siteCtx, authorIndex), buildRelatedAuthorsContext(doc, authorIndex)),
      },
    ],
    buildBlockContext: (doc, siteCtx, _primaryRendered, authorIndex) =>
      mergeContexts(buildContext(doc, siteCtx, authorIndex), buildRelatedAuthorsContext(doc, authorIndex)),
  },

  {
    type: 'author',
    phase: 'primary',
    canBeBlock: true,
    paginated: true,
    // Pool de páginas: docs tipo file (para listar publicaciones del autor).
    buildPool: (rendered) => [...(rendered.get('file') ?? [])],
    buildPageContexts: (doc, siteCtx, pool, _authorIndex, limit) => buildPagedAuthorPipelineContexts(doc, siteCtx, pool, limit),
    buildBlockContext: (doc, siteCtx, primaryRendered, _authorIndex) => buildAuthorPipelineContext(doc, siteCtx, primaryRendered.get('file') ?? []),
  },

  {
    type: 'event',
    phase: 'primary',
    canBeBlock: true,
    paginated: false,
    buildPool: () => [],
    buildPageContexts: (doc, siteCtx, _pool, authorIndex) => [{ ...doc, templateContext: buildEventPipelineContext(doc, siteCtx, authorIndex) }],
    buildBlockContext: (doc, siteCtx, _primaryRendered, authorIndex) => buildEventPipelineContext(doc, siteCtx, authorIndex),
  },

  // ─── FASE INDEX ──────────────────────────────────────────────────────────

  {
    type: 'collection',
    phase: 'index',
    canBeBlock: true,
    paginated: true,
    // Pool de páginas: docs de tipos primarios (items declarados en frontmatter).
    buildPool: (rendered) => [...(rendered.get('file') ?? []), ...(rendered.get('author') ?? []), ...(rendered.get('event') ?? [])],
    buildPageContexts: (doc, siteCtx, pool, authorIndex, limit) => buildPagedCollectionPipelineContexts(doc, siteCtx, pool, limit, authorIndex),
    // Pool de bloques: mismo conjunto (solo primarios disponibles en el pre-paso).
    buildBlockContext: (doc, siteCtx, primaryRendered, authorIndex) => {
      const pool = [...(primaryRendered.get('file') ?? []), ...(primaryRendered.get('author') ?? []), ...(primaryRendered.get('event') ?? [])];
      return buildCollectionPipelineContext(doc, siteCtx, pool, authorIndex);
    },
  },

  {
    type: 'authors',
    phase: 'index',
    canBeBlock: true,
    paginated: true,
    // Pool de páginas: docs de tipo author.
    buildPool: (rendered) => [...(rendered.get('author') ?? [])],
    buildPageContexts: (doc, siteCtx, pool, _authorIndex, limit) => buildPagedAuthorsPipelineContexts(doc, siteCtx, pool, limit),
    // Pool de bloques: mismos docs de tipo author (disponibles en pre-paso).
    buildBlockContext: (doc, siteCtx, primaryRendered, _authorIndex) =>
      buildAuthorsPipelineContext(doc, siteCtx, primaryRendered.get('author') ?? []),
  },

  {
    type: 'events',
    phase: 'index',
    canBeBlock: true,
    paginated: true,
    // Pool de páginas: docs de tipo event.
    buildPool: (rendered) => [...(rendered.get('event') ?? [])],
    buildPageContexts: (doc, siteCtx, pool, _authorIndex, limit) => buildPagedEventsPipelineContexts(doc, siteCtx, pool, limit),
    // Pool de bloques: mismos docs de tipo event (disponibles en pre-paso).
    buildBlockContext: (doc, siteCtx, primaryRendered, _authorIndex) => buildEventsPipelineContext(doc, siteCtx, primaryRendered.get('event') ?? []),
  },

  {
    type: 'menu',
    phase: 'index',
    canBeBlock: true,
    paginated: false,
    buildPool: () => [],
    buildPageContexts: (doc, siteCtx) => [{ ...doc, templateContext: buildMenuPipelineContext(doc, siteCtx) }],
    buildBlockContext: (doc, siteCtx) => buildMenuPipelineContext(doc, siteCtx),
  },

  {
    type: 'card',
    phase: 'index',
    canBeBlock: true,
    paginated: false,
    buildPool: () => [],
    buildPageContexts: (doc, siteCtx) => [{ ...doc, templateContext: buildCardPipelineContext(doc, siteCtx) }],
    buildBlockContext: (doc, siteCtx) => buildCardPipelineContext(doc, siteCtx),
  },

  {
    type: 'list',
    phase: 'index',
    canBeBlock: true,
    paginated: true,
    // Pool de páginas: todos los docs renderizados disponibles hasta este punto
    // (incluye los propios list para que filters.type: [list] devuelva resultados).
    buildPool: (rendered) => [...rendered.values()].flat(),
    buildPageContexts: (doc, siteCtx, pool, authorIndex, limit) => buildPagedListPipelineContexts(doc, siteCtx, pool, limit, authorIndex),
    // Pool de bloques: solo docs de tipo file (limitación del pre-paso de bloques;
    // collection, card, etc. aún no están renderizados en ese punto).
    buildBlockContext: (doc, siteCtx, primaryRendered, authorIndex) =>
      buildListPipelineContext(doc, siteCtx, primaryRendered.get('file') ?? [], authorIndex),
  },
];

/**
 * Set de todos los DocumentType registrados en el type-graph.
 * Fuente de verdad única para `inferType` en el clasificador.
 * Divergir de `DocumentType` union causará un error de compilación.
 */
export const VALID_TYPES = new Set<DocumentType>(TYPE_STAGES.map((s) => s.type));

/**
 * Mapa de lookup O(1): DocumentType → TypeStageSpec.
 * Construido una sola vez al cargar el módulo; preferir sobre `TYPE_STAGES.find()`.
 */
export const TYPE_STAGE_MAP: ReadonlyMap<DocumentType, TypeStageSpec> = new Map(TYPE_STAGES.map((s) => [s.type, s]));
