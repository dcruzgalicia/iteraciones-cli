import type { TemplateContext } from '../../template/render/context.js';
import type { AuthorDocumentIndex, BuildDocument, DocumentType } from '../types.js';

/**
 * Especificación de un tipo de documento en el pipeline.
 *
 * Define cómo se construye el contexto del template tanto para páginas (kind=page)
 * como para bloques (kind=block), y qué documentos renderizados necesita cada uno.
 *
 * Para agregar un nuevo DocumentType al sistema basta con:
 *   1. Añadir el tipo al union `DocumentType` en `types.ts`.
 *   2. Añadir una `TypeStageSpec` en `type-graph.ts`.
 * No se necesita modificar el orquestador ni ningún otro archivo.
 */
export interface TypeStageSpec {
  /** Tipo de documento que describe esta spec. */
  readonly type: DocumentType;

  /**
   * Fase de procesamiento:
   * - 'primary': file, author, event — se renderizan antes del pre-paso de bloques.
   * - 'index': el resto — se procesan después del pre-paso de bloques.
   */
  readonly phase: 'primary' | 'index';

  /** true si este tipo puede aparecer como bloque (kind === 'block'). */
  readonly canBeBlock: boolean;

  /** true si los documentos de este tipo se paginan con listItemsLimit. */
  readonly paginated: boolean;

  /**
   * Construye el pool de candidatos para el contexto de páginas de este tipo.
   * Se llama con el mapa de docs renderizados disponibles en el momento en que
   * se procesa este tipo (incluye primarios + todos los tipos index procesados antes).
   */
  buildPool(rendered: ReadonlyMap<DocumentType, BuildDocument[]>): BuildDocument[];

  /**
   * Construye el contexto del template para una página (kind !== 'block').
   * Para tipos paginados puede retornar múltiples BuildDocuments (uno por página).
   * Para tipos no paginados retorna un array de un solo elemento.
   */
  buildPageContexts(
    doc: BuildDocument,
    siteCtx: TemplateContext,
    pool: BuildDocument[],
    authorIndex: AuthorDocumentIndex,
    limit: number,
  ): BuildDocument[];

  /**
   * Construye el contexto del template para un bloque (kind === 'block').
   * `primaryRendered` contiene solo los tipos primarios (file, author, event),
   * que son los únicos disponibles en el momento del pre-paso de bloques.
   * Los bloques nunca se paginan.
   */
  buildBlockContext(
    doc: BuildDocument,
    siteCtx: TemplateContext,
    primaryRendered: ReadonlyMap<DocumentType, BuildDocument[]>,
    authorIndex: AuthorDocumentIndex,
  ): TemplateContext;
}
