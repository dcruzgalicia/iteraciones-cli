import type { SiteConfig } from '../config/config-schema.js';
import { type ActiveFormats, computeActiveFormats, type FormatKey, toActiveFormats } from '../config/site-config.js';
import type { BuildState } from './state.js';
import { type BibFileCache, computeBibHash, computeConfigHashes, computeFiltersHash, type FilterFileCache } from './state.js';
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
 * Formatos con conjunto de trabajo propio. La clave latex cubre la generación
 * de .tex y PDF (el hash de configuración "pdf" de state.ts agrupa ambos).
 */
type WorkFormatKey = 'latex' | 'html' | 'epub' | 'markdown';

export interface BuildMetadata {
  currentFormats: string[];
  newFormats: string[];
  removedFormats: string[];
  configHashes: Record<string, string>;
  filtersHash: string;
  /** Caché de archivos de filtro (mtime+size+hash) para persistir en state.json. */
  filterFileCache: FilterFileCache;
  bibHash: string;
  /** Caché de archivos de bibliografía (mtime+size+hash) para persistir en state.json. */
  bibFileCache: BibFileCache;
  formatInvalidated: Record<WorkFormatKey, boolean>;
  filtersInvalidated: boolean;
  bibInvalidated: boolean;
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
}

/**
 * Calcula la metadata de invalidación del build: hashes content-addressed,
 * formatos activos/nuevos/eliminados y flags de formato. No tiene efectos
 * secundarios (los mensajes de invalidación los emite el orquestador).
 */
export async function computeBuildMetadata(cwd: string, siteConfig: SiteConfig, prevState: BuildState | null): Promise<BuildMetadata> {
  const currentFormats = computeActiveFormats(siteConfig.format);

  const [configHashes, filtersHashResult, bibHashResult] = await Promise.all([
    computeConfigHashes(cwd, siteConfig),
    computeFiltersHash(cwd, siteConfig, prevState?.filterFileCache),
    computeBibHash(cwd, siteConfig, prevState?.bibFileCache),
  ]);
  const filtersHash = filtersHashResult.hash;
  const filterFileCache = filtersHashResult.cache;

  const prevHashes = prevState?.configHashes;
  const formatInvalidated: Record<WorkFormatKey, boolean> = {
    latex: prevState !== null && prevHashes?.pdf !== configHashes.pdf,
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
  const pdfOn = activeFormats.pdf;
  const latexOn = activeFormats.latex;
  const htmlOn = activeFormats.html;
  const epubOn = activeFormats.epub;
  const mdOn = activeFormats.markdown;
  const generateLatex = pdfOn || latexOn;
  const needsCss = htmlOn;

  return {
    currentFormats,
    newFormats,
    removedFormats,
    configHashes,
    filtersHash,
    filterFileCache,
    bibHash: bibHashResult.hash,
    bibFileCache: bibHashResult.cache,
    formatInvalidated,
    filtersInvalidated,
    bibInvalidated,
    activeFormats,
    generateLatex,
    needsCss,
  };
}

/**
 * Calcula los conjuntos de trabajo del build a partir de la metadata y el
 * resultado de discover. Función pura: el orquestador solo decide si ejecuta
 * y qué early return tomar según `anyWork` y los tamaños de los conjuntos.
 */
export function computeWorkSets(meta: BuildMetadata, allDocs: BuildDocument[], discoveredChanges: Set<string>): WorkSets {
  const { activeFormats, formatInvalidated } = meta;
  const pdfOn = activeFormats.pdf;
  const latexOn = activeFormats.latex;
  const htmlOn = activeFormats.html;
  const epubOn = activeFormats.epub;
  const mdOn = activeFormats.markdown;

  // docsChanged: documentos cuyo markdown o filters cambiaron y deben
  // re-convertirse desde el markdown original. La bibliografía NO los
  // re-renderiza: las citas se resuelven en la exportación (citeproc/biblatex),
  // así que bibInvalidated solo llena los exportSets más abajo.
  const docsChanged = new Set(discoveredChanges);
  if (meta.filtersInvalidated) {
    for (const doc of allDocs) {
      docsChanged.add(doc.relativePath);
    }
  }

  const anyWork =
    docsChanged.size > 0 ||
    (formatInvalidated.latex && (pdfOn || latexOn)) ||
    (formatInvalidated.html && htmlOn) ||
    (formatInvalidated.epub && epubOn) ||
    (formatInvalidated.markdown && mdOn) ||
    (meta.bibInvalidated && (pdfOn || latexOn || htmlOn || epubOn || mdOn));

  const bibInvalidated = meta.bibInvalidated;
  const exportSets: Record<WorkFormatKey, BuildDocument[]> = {
    latex: pdfOn || latexOn ? allDocs.filter((d) => docsChanged.has(d.relativePath) || formatInvalidated.latex || bibInvalidated) : [],
    html: htmlOn ? allDocs.filter((d) => docsChanged.has(d.relativePath) || formatInvalidated.html || bibInvalidated) : [],
    epub: epubOn ? allDocs.filter((d) => docsChanged.has(d.relativePath) || formatInvalidated.epub || bibInvalidated) : [],
    markdown: mdOn ? allDocs.filter((d) => docsChanged.has(d.relativePath) || formatInvalidated.markdown || bibInvalidated) : [],
  };

  return {
    docsChanged,
    anyWork,
    exportSets,
  };
}
