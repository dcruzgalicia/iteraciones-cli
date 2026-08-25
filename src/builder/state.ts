/**
 * Estado del build (caché content-addressed). Barrel que re-exporta la API de
 * los tres módulos especializados:
 *
 * - `state-serialize.ts` — persistencia de state.json (load/save/clear/update).
 * - `state-hash.ts` — hashes de invalidación de filtros y configuración.
 * - `state-bib.ts` — hashes de bibliografía, descubrimiento y resolución.
 */

export {
  type BibFileCache,
  computeBibHash,
  discoverBibFiles,
  resolveBibOptions,
} from './state-bib.js';
export {
  computeConfigHashes,
  computeFiltersHash,
  computeSchemaSourceHash,
  type FilterFileCache,
} from './state-hash.js';
export {
  type BuildState,
  clearStateFile,
  hashFileContent,
  hashString,
  loadStateFile,
  markStateCompleted,
  persistCompletedState,
  saveStateFile,
  stateUsableForBuild,
} from './state-serialize.js';
