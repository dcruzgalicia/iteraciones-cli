import type { SiteConfig } from '../config/site-config.js';
import { computeActiveFormats } from '../config/site-config.js';
import { computeCssInputHash } from './build-assets.js';
import type { BuildState } from './discover.js';
import { computeBibHash, computeConfigHashes, computeFiltersHash, type FilterFileCache } from './state.js';
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

type FormatKey = 'pdf' | 'html' | 'epub' | 'markdown';

export interface BuildMetadata {
  currentFormats: string[];
  newFormats: string[];
  removedFormats: string[];
  configHashes: Record<string, string>;
  filtersHash: string;
  /** Caché de archivos de filtro (mtime+size+hash) para persistir en state.json. */
  filterFileCache: FilterFileCache;
  bibHash: string;
  /** Hash de los inputs del CSS (acento + estilos) para decidir si regenerar Tailwind. */
  cssInputHash: string;
  formatInvalidated: Record<FormatKey, boolean>;
  filtersInvalidated: boolean;
  bibInvalidated: boolean;
  pdfOn: boolean;
  latexOn: boolean;
  htmlOn: boolean;
  epubOn: boolean;
  mdOn: boolean;
  /** EPUB, Markdown y HTML se exportan directamente desde el AST canónico. */
  generateLatex: boolean;
  needsCss: boolean;
}

export interface WorkSets {
  /** Documentos cuyo AST debe regenerarse (markdown cambiado, filters o bibliografía). */
  astChanged: Set<string>;
  anyWork: boolean;
  renderDocs: BuildDocument[];
  exportSets: Record<FormatKey, BuildDocument[]>;
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
  noCss?: boolean,
): Promise<BuildMetadata> {
  const currentFormats = computeActiveFormats(siteConfig.format);

  const [configHashes, filtersHashResult, bibHash, cssInputHash] = await Promise.all([
    computeConfigHashes(cwd, siteConfig),
    computeFiltersHash(cwd, siteConfig, prevState?.filterFileCache),
    computeBibHash(cwd, siteConfig),
    computeCssInputHash(siteConfig),
  ]);
  const filtersHash = filtersHashResult.hash;
  const filterFileCache = filtersHashResult.cache;

  const prevHashes = prevState?.configHashes;
  const formatInvalidated: Record<FormatKey, boolean> = {
    pdf: prevState !== null && prevHashes?.pdf !== configHashes.pdf,
    html: prevState !== null && prevHashes?.html !== configHashes.html,
    epub: prevState !== null && prevHashes?.epub !== configHashes.epub,
    markdown: prevState !== null && prevHashes?.markdown !== configHashes.markdown,
  };
  const filtersInvalidated = prevState !== null && prevState.filtersHash !== filtersHash;
  const bibInvalidated = prevState !== null && prevState.bibHash !== bibHash;

  let newFormats: string[] = [];
  let removedFormats: string[] = [];
  if (prevState !== null) {
    const prevFormats = new Set(prevState.activeFormats);
    newFormats = currentFormats.filter((f) => !prevFormats.has(f));
    removedFormats = prevState.activeFormats.filter((f) => !currentFormats.includes(f));
  }

  const formatCfg = siteConfig.format;
  const pdfOn = formatCfg?.pdf?.generate === true;
  const latexOn = formatCfg?.latex === true;
  const htmlOn = formatCfg?.html?.generate === true;
  const epubOn = formatCfg?.epub?.generate === true;
  const mdOn = formatCfg?.markdown?.generate === true;
  const generateLatex = pdfOn || latexOn;
  const needsCss = htmlOn && !noCss;

  return {
    currentFormats,
    newFormats,
    removedFormats,
    configHashes,
    filtersHash,
    filterFileCache,
    bibHash,
    cssInputHash,
    formatInvalidated,
    filtersInvalidated,
    bibInvalidated,
    pdfOn,
    latexOn,
    htmlOn,
    epubOn,
    mdOn,
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
  const { pdfOn, latexOn, htmlOn, epubOn, mdOn, formatInvalidated } = meta;

  // astChanged: documentos cuyo AST debe regenerarse (markdown cambiado, filters o bibliografía)
  const astChanged = new Set(discoveredChanges);
  if (meta.filtersInvalidated || meta.bibInvalidated) {
    for (const doc of allDocs) {
      astChanged.add(doc.relativePath);
    }
  }

  const anyWork =
    astChanged.size > 0 ||
    (formatInvalidated.pdf && (pdfOn || latexOn)) ||
    (formatInvalidated.html && htmlOn) ||
    (formatInvalidated.epub && epubOn) ||
    (formatInvalidated.markdown && mdOn);

  const renderDocs = allDocs.filter((d) => astChanged.has(d.relativePath));
  const exportSets: Record<FormatKey, BuildDocument[]> = {
    pdf: pdfOn || latexOn ? allDocs.filter((d) => astChanged.has(d.relativePath) || formatInvalidated.pdf) : [],
    html: htmlOn ? allDocs.filter((d) => astChanged.has(d.relativePath) || formatInvalidated.html) : [],
    epub: epubOn ? allDocs.filter((d) => astChanged.has(d.relativePath) || formatInvalidated.epub) : [],
    markdown: mdOn ? allDocs.filter((d) => astChanged.has(d.relativePath) || formatInvalidated.markdown) : [],
  };

  return {
    astChanged,
    anyWork,
    renderDocs,
    exportSets,
  };
}
