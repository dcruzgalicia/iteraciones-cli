import type { SiteConfig } from '../config/config-schema.js';
import { type ActiveFormats, computeActiveFormats, toActiveFormats } from '../config/site-config.js';
import type { BibOptions } from '../lib/pandoc-runner.js';
import { computeBibHash, resolveBibOptions } from './state-bib.js';
import { computeConfigHashes, computeFiltersHash } from './state-hash.js';
import type { BibFileCache, BuildState, FileCacheEntry, FilterFileCache } from './state-serialize.js';
import type { BuildDocument } from './types.js';

/** Los cuatro grupos de trabajo, en el orden en que se recorren. El tipo sale de aquí. */
export const WORK_FORMATS = ['print', 'html', 'epub', 'markdown'] as const;
type WorkFormatKey = (typeof WORK_FORMATS)[number];

export interface BuildMetadata {
  currentFormats: string[];
  newFormats: string[];
  removedFormats: string[];
  configHashes: Record<string, string>;
  configFileCache: Record<string, FileCacheEntry>;
  filtersHash: string;
  filterFileCache: FilterFileCache;
  schemaFileCache: Record<string, FileCacheEntry>;
  bibHash: string;
  bibFileCache: BibFileCache;
  formatInvalidated: Record<WorkFormatKey, boolean>;
  filtersInvalidated: boolean;
  bibInvalidated: boolean;
  bibFiles: string[];
  bibOptions?: BibOptions;
  activeFormats: ActiveFormats;
  generateLatex: boolean;
  needsCss: boolean;
}

export interface WorkSets {
  docsChanged: Set<string>;
  anyWork: boolean;
  exportSets: Record<WorkFormatKey, BuildDocument[]>;
  workPaths: Record<WorkFormatKey, Set<string>>;
  workDocList: BuildDocument[];
}

export async function computeBuildMetadata(
  cwd: string,
  siteConfig: SiteConfig,
  prevState: BuildState | null,
  effectiveDisabledPreamble?: string[],
  pandocVersion?: string,
): Promise<BuildMetadata> {
  const bib = await resolveBibOptions(cwd, siteConfig);
  const [configResult, filtersHashResult, bibHashResult] = await Promise.all([
    computeConfigHashes(cwd, siteConfig, prevState?.configFileCache),
    computeFiltersHash(cwd, siteConfig, prevState?.filterFileCache, effectiveDisabledPreamble, pandocVersion, prevState?.schemaFileCache),
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

  // Se ensancha a string[] porque el diff de abajo compara contra
  // `prevState.activeFormats`, que viene del state.json y es string[].
  const currentFormats: string[] = computeActiveFormats(siteConfig.format);

  let newFormats: string[] = [];
  let removedFormats: string[] = [];
  if (prevState !== null) {
    const prevFormats = new Set(prevState.activeFormats);
    newFormats = currentFormats.filter((f) => !prevFormats.has(f));
    removedFormats = prevState.activeFormats.filter((f) => !currentFormats.includes(f));
  }

  const activeFormats = toActiveFormats(computeActiveFormats(siteConfig.format));
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
    schemaFileCache: filtersHashResult.schemaCache,
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

interface ExportGroup {
  key: WorkFormatKey;
  enabled: boolean;
}

const emptyWorkSets = (): Record<WorkFormatKey, BuildDocument[]> =>
  Object.fromEntries(WORK_FORMATS.map((key) => [key, [] as BuildDocument[]])) as Record<WorkFormatKey, BuildDocument[]>;

function exportGroupsFor(activeFormats: ActiveFormats): ExportGroup[] {
  // `print` agrupa PDF y LaTeX: comparten salida, así que uno basta para activarlo.
  return WORK_FORMATS.map((key) => ({ key, enabled: key === 'print' ? activeFormats.pdf || activeFormats.latex : activeFormats[key] }));
}

function collectWorkDocs(exportSets: Record<WorkFormatKey, BuildDocument[]>, docsChanged: Set<string>, allDocs: BuildDocument[]): BuildDocument[] {
  const workDocs = new Map<string, BuildDocument>();
  for (const doc of WORK_FORMATS.flatMap((key) => exportSets[key])) {
    workDocs.set(doc.relativePath, doc);
  }
  for (const doc of allDocs) {
    if (docsChanged.has(doc.relativePath)) workDocs.set(doc.relativePath, doc);
  }
  return [...workDocs.values()];
}

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
 * #2453 — en modo parcial la selección manda: lo que venga de fuera se acota y
 * lo pedido se fuerza. Sin el forzado, `build doc.md` sobre un documento sin
 * cambios acabaría en «nada que hacer» y el usuario no obtendría nada. Dentro
 * de `computeDocsChanged` afectaría también al modo completo, así que va aquí.
 */
function applySelection(docsChanged: Set<string>, selection: Set<string> | undefined): void {
  if (selection === undefined) return;
  for (const path of [...docsChanged]) {
    if (!selection.has(path)) docsChanged.delete(path);
  }
  for (const path of selection) docsChanged.add(path);
}

export function computeWorkSets(
  meta: BuildMetadata,
  allDocs: BuildDocument[],
  discoveredChanges: Set<string>,
  outputDirChanged = false,
  selection?: Set<string>,
): WorkSets {
  const groups = exportGroupsFor(meta.activeFormats);

  const docsChanged = computeDocsChanged(discoveredChanges, allDocs, meta.filtersInvalidated || outputDirChanged);
  applySelection(docsChanged, selection);

  const anyWork =
    docsChanged.size > 0 ||
    (meta.formatInvalidated.print && (meta.activeFormats.pdf || meta.activeFormats.latex)) ||
    (meta.formatInvalidated.html && meta.activeFormats.html) ||
    (meta.formatInvalidated.epub && meta.activeFormats.epub) ||
    (meta.formatInvalidated.markdown && meta.activeFormats.markdown) ||
    (meta.bibInvalidated &&
      (meta.activeFormats.pdf || meta.activeFormats.latex || meta.activeFormats.html || meta.activeFormats.epub || meta.activeFormats.markdown));

  const exportSets = emptyWorkSets();
  for (const group of groups) {
    if (!group.enabled) continue;
    exportSets[group.key] = allDocs.filter((d) => docsChanged.has(d.relativePath) || meta.formatInvalidated[group.key] || meta.bibInvalidated);
  }

  const workPaths = Object.fromEntries(WORK_FORMATS.map((key) => [key, new Set(exportSets[key].map((d) => d.relativePath))])) as Record<
    WorkFormatKey,
    Set<string>
  >;
  const workDocList = collectWorkDocs(exportSets, docsChanged, allDocs);

  return { docsChanged, anyWork, exportSets, workPaths, workDocList };
}
