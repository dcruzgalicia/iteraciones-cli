import type { SiteConfig } from '../config/config-schema.js';
import { type ActiveFormats, computeActiveFormats, type FormatKey, toActiveFormats } from '../config/site-config.js';
import type { BibOptions } from '../lib/pandoc-runner.js';
import { type BibFileCache, computeBibHash, resolveBibOptions } from './state-bib.js';
import { computeConfigHashes, computeFiltersHash, type FilterFileCache } from './state-hash.js';
import type { BuildState } from './state-serialize.js';
import type { BuildDocument } from './types.js';

type WorkFormatKey = 'print' | 'html' | 'epub' | 'markdown';

export interface BuildMetadata {
  currentFormats: string[];
  newFormats: string[];
  removedFormats: string[];
  configHashes: Record<string, string>;
  configFileCache: Record<string, import('./state-hash.js').FileCacheEntry>;
  filtersHash: string;
  filterFileCache: FilterFileCache;
  schemaFileCache: Record<string, import('./state-hash.js').FileCacheEntry>;
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
  const currentFormats = computeActiveFormats(siteConfig.format);

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

function exportGroupsFor(activeFormats: ActiveFormats): ExportGroup[] {
  return [
    { key: 'print', enabled: activeFormats.pdf || activeFormats.latex },
    { key: 'html', enabled: activeFormats.html },
    { key: 'epub', enabled: activeFormats.epub },
    { key: 'markdown', enabled: activeFormats.markdown },
  ];
}

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

function computeDocsChanged(discoveredChanges: Set<string>, allDocs: BuildDocument[], addAllDocs: boolean): Set<string> {
  const docsChanged = new Set(discoveredChanges);
  if (addAllDocs) {
    for (const doc of allDocs) {
      docsChanged.add(doc.relativePath);
    }
  }
  return docsChanged;
}

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

  const workPaths: Record<WorkFormatKey, Set<string>> = {
    print: new Set(exportSets.print.map((d) => d.relativePath)),
    html: new Set(exportSets.html.map((d) => d.relativePath)),
    epub: new Set(exportSets.epub.map((d) => d.relativePath)),
    markdown: new Set(exportSets.markdown.map((d) => d.relativePath)),
  };
  const workDocList = collectWorkDocs(exportSets, docsChanged, allDocs);

  return { docsChanged, anyWork, exportSets, workPaths, workDocList };
}
