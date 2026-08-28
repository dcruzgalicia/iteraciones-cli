import type { SiteConfig } from '../config/config-schema.js';
import { type ActiveFormats, computeActiveFormats, type FormatKey, toActiveFormats } from '../config/site-config.js';
import type { BibOptions } from '../lib/pandoc-runner.js';
import type { BuildState } from './state.js';
import { type BibFileCache, computeBibHash, computeConfigHashes, computeFiltersHash, type FilterFileCache, resolveBibOptions } from './state.js';
import type { BuildDocument } from './types.js';

/**
 * Planificador del build: separa la planificación (qué trabajo hacer) de la
 * ejecución (hacerlo). Dos fases puras:
 *
 * 1. `computeBuildMetadata()` — hashes de invalidación y formatos activos.
 *    Se llama antes de discover (sus hashes se guardan como meta del estado).
 * 2. `computeWorkSets()` — conjuntos de trabajo (qué documentos renderizar,
 *    qué formatos exportar) a partir de la metadata y el resultado de discover.
 *
 * Ambas son deterministas: mismo input → mismo output, sin efectos secundarios.
 */

/**
 * Formatos con conjunto de trabajo propio. La clave `print` cubre la
 * generación de .tex y la compilación PDF (una sola frontera de trabajo: el
 * hash de configuración "pdf" de state.ts agrupa ambos; la fase del tracker
 * sigue llamándose `latex`).
 */
type WorkFormatKey = 'print' | 'html' | 'epub' | 'markdown';

export interface BuildMetadata {
  currentFormats: string[];
  newFormats: string[];
  removedFormats: string[];
  configHashes: Record<string, string>;
  /** Caché mtime+size de recursos de config (recursos HTML, logo) para persistir (#2091). */
  configFileCache: Record<string, import('./state-hash.js').FileCacheEntry>;
  filtersHash: string;
  /** Caché de archivos de filtro (mtime+size+hash) para persistir en state.json. */
  filterFileCache: FilterFileCache;
  bibHash: string;
  /** Caché de archivos de bibliografía (mtime+size+hash) para persistir en state.json. */
  bibFileCache: BibFileCache;
  formatInvalidated: Record<WorkFormatKey, boolean>;
  filtersInvalidated: boolean;
  bibInvalidated: boolean;
  /** Bibliografía resuelta UNA vez por build (#2167): el pipeline la consume sin re-resolver. */
  bibFiles: string[];
  bibOptions?: BibOptions;
  /** Mapa canónico de formatos activos (pdf, latex, html, epub, markdown). */
  activeFormats: ActiveFormats;
  /** true si se genera LaTeX intermedio (pdf o latex activos). */
  generateLatex: boolean;
  needsCss: boolean;
}

export interface WorkSets {
  /** Documentos cuyo contenido cambió (markdown o filters) y deben re-procesarse. */
  docsChanged: Set<string>;
  anyWork: boolean;
  exportSets: Record<WorkFormatKey, BuildDocument[]>;
  /**
   * Representación DERIVADA única (#2176): los paths por formato y la lista
   * unida de documentos con trabajo se calculan UNA vez aquí; ni el
   * orquestador ni el pipeline reconstruyen Sets ni uniones.
   */
  workPaths: Record<WorkFormatKey, Set<string>>;
  workDocList: BuildDocument[];
}

/**
 * Calcula la metadata de invalidación del build: hashes content-addressed,
 * formatos activos/nuevos/eliminados y flags de formato. No tiene efectos
 * secundarios (los mensajes de invalidación los emite el orquestador).
 */
export async function computeBuildMetadata(
  cwd: string,
  siteConfig: SiteConfig,
  prevState: BuildState | null,
  effectiveDisabledPreamble?: string[],
  pandocVersion?: string,
): Promise<BuildMetadata> {
  const currentFormats = computeActiveFormats(siteConfig.format);

  // La bibliografía se resuelve UNA vez por build (#2167): el mismo resultado
  // alimenta el hash de invalidación y el pipeline (documentPipeline consume
  // plan.bibOptions/plan.bibFiles).
  const bib = await resolveBibOptions(cwd, siteConfig);
  const [configResult, filtersHashResult, bibHashResult] = await Promise.all([
    computeConfigHashes(cwd, siteConfig, prevState?.configFileCache),
    computeFiltersHash(cwd, siteConfig, prevState?.filterFileCache, effectiveDisabledPreamble, pandocVersion),
    computeBibHash(bib, prevState?.bibFileCache),
  ]);
  const { hashes: configHashes, cache: configFileCache } = configResult;
  const filtersHash = filtersHashResult.hash;
  const filterFileCache = filtersHashResult.cache;

  const prevHashes = prevState?.configHashes;
  const formatInvalidated: Record<WorkFormatKey, boolean> = {
    print: prevState !== null && prevHashes?.pdf !== configHashes.pdf,
    html: prevState !== null && prevHashes?.html !== configHashes.html,
    epub: prevState !== null && prevHashes?.epub !== configHashes.epub,
    markdown: prevState !== null && prevHashes?.markdown !== configHashes.markdown,
  };
  const filtersInvalidated = prevState !== null && prevState.filtersHash !== filtersHash;
  const bibInvalidated = prevState !== null && prevState.bibHash !== bibHashResult.hash;

  let newFormats: string[] = [];
  let removedFormats: string[] = [];
  if (prevState !== null) {
    const prevFormats = new Set(prevState.activeFormats);
    newFormats = currentFormats.filter((f) => !prevFormats.has(f));
    removedFormats = prevState.activeFormats.filter((f) => !currentFormats.includes(f));
  }

  const activeFormats = toActiveFormats(currentFormats as FormatKey[]);
  const generateLatex = activeFormats.pdf || activeFormats.latex;
  const needsCss = activeFormats.html;

  return {
    currentFormats,
    newFormats,
    removedFormats,
    configHashes,
    configFileCache,
    filtersHash,
    filterFileCache,
    bibHash: bibHashResult.hash,
    bibFileCache: bibHashResult.cache,
    formatInvalidated,
    filtersInvalidated,
    bibInvalidated,
    bibFiles: bib.bibFiles,
    bibOptions: bib.bibOptions,
    activeFormats,
    generateLatex,
    needsCss,
  };
}

/** Formatos activos agrupados: latex encapsula pdf+latex (hash "pdf" común). */
interface ExportGroup {
  key: WorkFormatKey;
  /** El formato está activo en este build. */
  enabled: boolean;
}

/** Grupos de exportación del build actual (orden determinista del Record final). */
function exportGroupsFor(activeFormats: ActiveFormats): ExportGroup[] {
  return [
    // La clave latex cubre la generación de .tex y PDF.
    { key: 'print', enabled: activeFormats.pdf || activeFormats.latex },
    { key: 'html', enabled: activeFormats.html },
    { key: 'epub', enabled: activeFormats.epub },
    { key: 'markdown', enabled: activeFormats.markdown },
  ];
}

/** Unión de documentos con trabajo: exportSets (formatos activos) + docsChanged. */
function collectWorkDocs(exportSets: Record<WorkFormatKey, BuildDocument[]>, docsChanged: Set<string>, allDocs: BuildDocument[]): BuildDocument[] {
  const workDocs = new Map<string, BuildDocument>();
  for (const doc of [...exportSets.print, ...exportSets.html, ...exportSets.epub, ...exportSets.markdown]) {
    workDocs.set(doc.relativePath, doc);
  }
  for (const doc of allDocs) {
    if (docsChanged.has(doc.relativePath)) workDocs.set(doc.relativePath, doc);
  }
  return [...workDocs.values()];
}

/**
 * Documentos cuyo markdown o filters cambiaron y deben reconvertirse desde el
 * markdown original. Si los filters se invalidaron (o cambió outputDir), TODOS
 * re-procesan. La bibliografía NO entra aquí: las citas se resuelven en la
 * exportación (citeproc/biblatex), así que bibInvalidated solo llena los
 * exportSets.
 */
function computeDocsChanged(discoveredChanges: Set<string>, allDocs: BuildDocument[], addAllDocs: boolean): Set<string> {
  const docsChanged = new Set(discoveredChanges);
  if (addAllDocs) {
    for (const doc of allDocs) {
      docsChanged.add(doc.relativePath);
    }
  }
  return docsChanged;
}

/**
 * Calcula los conjuntos de trabajo del build a partir de la metadata y el
 * resultado de discover. Función pura: el orquestador solo decide si ejecuta
 * y qué early return tomar según `anyWork` y los tamaños de los conjuntos.
 *
 * `outputDirChanged` fuerza el reprocesamiento completo: un cambio del
 * directorio de salida entre builds invalida toda la caché (los documentos
 * deben regenerarse en el directorio nuevo, y la vuelta al anterior también).
 */
export function computeWorkSets(meta: BuildMetadata, allDocs: BuildDocument[], discoveredChanges: Set<string>, outputDirChanged = false): WorkSets {
  const groups = exportGroupsFor(meta.activeFormats);

  const docsChanged = computeDocsChanged(discoveredChanges, allDocs, meta.filtersInvalidated || outputDirChanged);

  const anyWork =
    docsChanged.size > 0 ||
    (meta.formatInvalidated.print && (meta.activeFormats.pdf || meta.activeFormats.latex)) ||
    (meta.formatInvalidated.html && meta.activeFormats.html) ||
    (meta.formatInvalidated.epub && meta.activeFormats.epub) ||
    (meta.formatInvalidated.markdown && meta.activeFormats.markdown) ||
    (meta.bibInvalidated &&
      (meta.activeFormats.pdf || meta.activeFormats.latex || meta.activeFormats.html || meta.activeFormats.epub || meta.activeFormats.markdown));

  const exportSets: Record<WorkFormatKey, BuildDocument[]> = { print: [], html: [], epub: [], markdown: [] };
  for (const group of groups) {
    if (!group.enabled) continue;
    exportSets[group.key] = allDocs.filter((d) => docsChanged.has(d.relativePath) || meta.formatInvalidated[group.key] || meta.bibInvalidated);
  }

  // Representación derivada única (#2176): paths por formato y unión de docs.
  const workPaths: Record<WorkFormatKey, Set<string>> = {
    print: new Set(exportSets.print.map((d) => d.relativePath)),
    html: new Set(exportSets.html.map((d) => d.relativePath)),
    epub: new Set(exportSets.epub.map((d) => d.relativePath)),
    markdown: new Set(exportSets.markdown.map((d) => d.relativePath)),
  };
  const workDocList = collectWorkDocs(exportSets, docsChanged, allDocs);

  return { docsChanged, anyWork, exportSets, workPaths, workDocList };
}
