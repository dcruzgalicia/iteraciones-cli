import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { logWarning } from '../lib/logger.js';
import type { BibOptions } from '../lib/pandoc-runner.js';
import { isIgnoredByRules, isInsideIgnoredDir, loadGitignoreRules } from './gitignore.js';
import { MD_READER } from './render.js';
import type { DiscoveryEntry } from './types.js';

/** Ruta relativa del archivo de estado del build dentro del proyecto. */
const STATE_PATH = join('.iteraciones', 'state.json');

/** Ruta del estado en versiones anteriores (se migra una sola vez). */
const LEGACY_STATE_PATH = join('.iteraciones', 'changes', 'state.json');

/** Recursos del template HTML del paquete (participan en la invalidación del formato HTML). */
const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');
const HTML_RESOURCE_FILES = [
  'skeleton.html',
  'card-identity.html',
  'card-identity-footer.html',
  'card-trayectura.html',
  'card-indice.html',
  'card-formatos.html',
  'card-referencias.html',
];

/** Entrada de caché de archivo de filtro (mtime+size evitan re-leer contenido). */
interface FilterFileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export type FilterFileCache = Record<string, FilterFileCacheEntry>;

/**
 * Estado del build (caché content-addressed), leído y guardado en state.json.
 * Combina el report (startedAt, activeFormats), el discovery index (entries)
 * y los hashes de invalidación (filters, config por formato, bibliografía).
 */
export interface BuildState {
  /** Timestamp del build anterior. */
  startedAt: number;
  /** Formatos que estaban activos en el build anterior. */
  activeFormats: string[];
  /** Directorio de salida usado por el último build (para el comando info). */
  outputDir?: string;
  /** Hash de los filters efectivos (paquete + proyecto) y sus disabled lists. */
  filtersHash?: string;
  /** Caché por archivo de filtro (mtime+size+hash) para evitar re-leer contenido. */
  filterFileCache?: FilterFileCache;
  /** Hash de configuración por formato (pdf, html, epub, markdown). */
  configHashes?: Record<string, string>;
  /** Hash de los archivos .bib y .csl del proyecto. */
  bibHash?: string;
  /** Caché por archivo de bibliografía (mtime+size+hash) para evitar re-leer contenido. */
  bibFileCache?: BibFileCache;
  /** Índice de descubrimiento: path relativo → entry con frontmatter y caché. */
  entries: Map<string, DiscoveryEntry>;
}

export function hashString(input: string): string {
  return Bun.CryptoHasher.hash('sha256', input, 'hex');
}

async function hashFileContent(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return Bun.CryptoHasher.hash('sha256', bytes, 'hex');
}

export async function loadStateFile(cwd: string): Promise<BuildState | null> {
  // Migración única: el estado vivía en .iteraciones/changes/state.json
  const legacy = Bun.file(join(cwd, LEGACY_STATE_PATH));
  if (!(await Bun.file(join(cwd, STATE_PATH)).exists()) && (await legacy.exists())) {
    try {
      await mkdir(dirname(join(cwd, STATE_PATH)), { recursive: true });
      await rename(join(cwd, LEGACY_STATE_PATH), join(cwd, STATE_PATH));
    } catch {
      // Si la migración falla, se lee el estado viejo directamente
    }
  }
  const file = Bun.file(join(cwd, STATE_PATH));
  if (!(await file.exists())) return null;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<BuildState>;
    if (typeof parsed.startedAt !== 'number') return null;
    return {
      startedAt: parsed.startedAt,
      activeFormats: Array.isArray(parsed.activeFormats) ? parsed.activeFormats : [],
      outputDir: parsed.outputDir,
      filtersHash: parsed.filtersHash,
      filterFileCache: parsed.filterFileCache,
      configHashes: parsed.configHashes,
      bibHash: parsed.bibHash,
      bibFileCache: parsed.bibFileCache,
      // En disco las entradas son un objeto; en runtime se usan como Map.
      entries: new Map(Object.entries((parsed.entries ?? {}) as Record<string, DiscoveryEntry>)),
    };
  } catch (err) {
    // state.json corrupto (build interrumpido a mitad de escritura): se ignora y se hará build completo
    logWarning(`no se pudo leer state.json; se hará build completo: ${String(err)}`, 'cache');
    return null;
  }
}

/**
 * Elimina el estado del build (tras un fallo): el siguiente build no tiene
 * índice de invalidación y reprocesa todo (nunca reutiliza contenido stale).
 */
export async function clearStateFile(cwd: string): Promise<void> {
  await rm(join(cwd, STATE_PATH), { force: true }).catch(() => {});
}

/**
 * Migración del caché de versiones anteriores (se ejecuta en cada build):
 * elimina los artefactos que el flujo actual ya no escribe ni consume.
 * Idempotente y barata; se conserva como red de seguridad para proyectos que
 * aún no hayan ejecutado un build con el flujo nuevo (la transición ya ocurrió
 * en los proyectos existentes).
 * - .iteraciones/ast/       (ASTs del flujo markdown → json, eliminado)
 * - .iteraciones/changes/   (estado migrado a state.json en la raíz)
 * - .iteraciones/formats/   (staging intermedio: los formatos se escriben
 *                            directamente en dist/ desde el build actual)
 */
export async function migrateLegacyCache(cwd: string): Promise<void> {
  await rm(join(cwd, '.iteraciones', 'ast'), { recursive: true, force: true }).catch(() => {});
  await rm(join(cwd, '.iteraciones', 'changes'), { recursive: true, force: true }).catch(() => {});
  await rm(join(cwd, '.iteraciones', 'formats'), { recursive: true, force: true }).catch(() => {});
}

/**
 * Guarda state.json de forma atómica (temp + rename): un build interrumpido
 * nunca deja el caché a medias.
 */
export async function saveStateFile(cwd: string, state: BuildState): Promise<void> {
  const filePath = join(cwd, STATE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify({ ...state, entries: Object.fromEntries(state.entries) }));
  try {
    await rename(tmpPath, filePath);
  } catch {
    // El destino ya existe en algunos sistemas (Windows): se elimina y se reintenta el rename
    await rm(filePath, { force: true });
    await rename(tmpPath, filePath);
  }
}

/**
 * Versiones de esquema de los outputs generados. Subir la versión de un área
 * cuando cambie su lógica de generación (invalida los outputs en el próximo
 * build). La lista completa de cuándo subir cada versión está en
 * CONTRIBUTING.md (sección "Cómo invalidar la caché de outputs").
 */
const CACHE_SCHEMA_VERSIONS = {
  /** Conversión yyyy-mm-dd → fecha legible (src/lib/date.ts). */
  humanDate: 'human-date-v1',
  /** Generación de la página HTML (pipeline.ts) y su post-procesamiento de referencias (render.ts). */
  htmlPage: 'html-page-v1',
  /** Composición del template LaTeX efectivo (latex-preamble.ts). */
  latexTemplate: 'latex-template-v1',
  /** Enlazado de citas del HTML (--metadata=link-citations). */
  linkCitations: 'link-citations-v1',
} as const;

/**
 * Hashea los filtros efectivos (paquete + proyecto) y de los preamble
 * filters, incluyendo las disabled lists. Cambia solo si el código de un
 * filter o la lista de desactivados cambia.
 *
 * Con `prevCache` (de state.json), cada archivo se compara por mtime+size:
 * si no cambió, se reutiliza su hash sin leer el contenido (mismo patrón
 * content-addressed que discover usa para los documentos).
 */
export async function computeFiltersHash(
  cwd: string,
  siteConfig: SiteConfig,
  prevCache?: FilterFileCache,
): Promise<{ hash: string; cache: FilterFileCache }> {
  const parts: string[] = [];
  const cache: FilterFileCache = {};
  // [directorio, glob]: filtros Lua del paquete y del proyecto, preamble .tex
  const specs: Array<[string, string]> = [
    [join(import.meta.dir, '../lib/resources/filters'), '**/*.lua'],
    [join(import.meta.dir, '../lib/resources/preamble'), '*.tex'],
    [join(cwd, 'filters'), '**/*.lua'],
    [join(cwd, 'preamble'), '*.tex'],
  ];
  for (const [dir, glob] of specs) {
    try {
      const files = [...new Bun.Glob(glob).scanSync({ cwd: dir })].sort();
      for (const file of files) {
        parts.push(file, await hashFilterFile(join(dir, file), prevCache, cache));
      }
    } catch {
      // Directorio inexistente (filters/preamble del proyecto son opcionales)
    }
  }
  // Filtros Lua de usuario (`lua-filters:`) — pueden estar en cualquier directorio
  for (const rel of siteConfig.luaFilters ?? []) {
    const content = await hashFilterFile(join(cwd, rel), prevCache, cache).catch(() => '');
    parts.push(rel, content);
  }
  parts.push(JSON.stringify(siteConfig.disabledFilters ?? []));
  parts.push(JSON.stringify(siteConfig.format?.pdf?.disabledPreambleFilters ?? []));
  // El reader del pipeline produce el AST canónico: si cambia, los ASTs
  // cacheados quedan obsoletos y todos los documentos deben re-renderizarse.
  parts.push(MD_READER);
  // Versiones de esquema de los outputs cacheados (ver CACHE_SCHEMA_VERSIONS).
  for (const version of Object.values(CACHE_SCHEMA_VERSIONS)) {
    parts.push(version);
  }
  return { hash: hashString(parts.join('\0')), cache };
}

/** Hash del contenido de un archivo de filtro, reutilizando el caché si mtime+size coinciden. */
async function hashFilterFile(abs: string, prevCache: FilterFileCache | undefined, cache: FilterFileCache): Promise<string> {
  const stat = await Bun.file(abs).stat();
  const mtime = Math.round(stat.mtimeMs);
  const size = stat.size;
  const prev = prevCache?.[abs];
  if (prev && prev.mtime === mtime && prev.size === size) {
    cache[abs] = prev;
    return prev.hash;
  }
  const content = await Bun.file(abs).text();
  const hash = hashString(content);
  cache[abs] = { mtime, size, hash };
  return hash;
}

/**
 * Hash de configuración por formato. Cada hash agrupa solo los inputs que
 * afectan a ese formato: cambiar format.pdf no invalida los outputs HTML.
 * - pdf: format.pdf + format.latex
 * - html: format.html + template.html + bloque site + logo
 * - epub: format.epub
 * - markdown: format.markdown + lang
 */
export async function computeConfigHashes(cwd: string, siteConfig: SiteConfig): Promise<Record<string, string>> {
  const fmt = siteConfig.format;
  const htmlConfig = fmt?.html;
  const htmlResources = (
    await Promise.all(
      HTML_RESOURCE_FILES.map((f) =>
        Bun.file(join(HTML_RESOURCES_DIR, f))
          .text()
          .catch(() => ''),
      ),
    )
  ).join('\n');
  const logoPath = htmlConfig?.logo?.trim();
  const logo = logoPath ? await hashFileContent(join(cwd, logoPath)).catch(() => '') : '';
  return {
    pdf: hashString(`${JSON.stringify(fmt?.pdf ?? {})}\n${String(fmt?.latex ?? false)}\n${String(siteConfig.toc ?? false)}`),
    // El HTML muestra la tarjeta Formatos con los formatos activos: cambiar
    // pdf/latex/epub/markdown debe regenerar las páginas HTML.
    html: hashString(
      `${JSON.stringify(fmt?.html ?? {})}\n${htmlResources}\n${logo}\n${String(siteConfig.toc ?? false)}\n` +
        `${String(fmt?.pdf?.generate ?? false)}\n${String(fmt?.latex ?? false)}\n${String(fmt?.epub?.generate ?? false)}\n${String(fmt?.markdown?.generate ?? false)}\n` +
        // lang se emite como --metadata=lang en el HTML: participar en el hash
        `${String(siteConfig.lang ?? '')}`,
    ),
    epub: hashString(`${JSON.stringify(fmt?.epub ?? {})}\n${String(siteConfig.toc ?? false)}\n${String(siteConfig.lang ?? '')}`),
    markdown: hashString(`${JSON.stringify(fmt?.markdown ?? {})}\n${String(siteConfig.lang ?? '')}`),
  };
}

/**
 * Descubre archivos de bibliografía del proyecto. Bun.Glob omite por defecto
 * los directorios ocultos (`.iteraciones/`, `.git/`); los directorios visibles
 * no deseados (node_modules, dist) se excluyen en cualquier profundidad.
 * @param extensions Extensiones a incluir (default: bib y csl).
 */
export async function discoverBibFiles(cwd: string, extensions: string[] = ['bib', 'csl']): Promise<string[]> {
  const results: string[] = [];
  const gitignoreRules = await loadGitignoreRules(cwd);
  try {
    const glob = new Bun.Glob(`**/*.{${extensions.join(',')}}`);
    for (const file of glob.scanSync({ cwd, absolute: true })) {
      const rel = file.replace(cwd, '').replace(/^[/\\]+/, '');
      if (isInsideIgnoredDir(rel)) continue;
      if (isIgnoredByRules(rel, gitignoreRules)) continue;
      results.push(file);
    }
  } catch {
    // Sin archivos de bibliografía
  }
  return results.sort();
}

/** Entrada de caché de archivo de bibliografía (mtime+size evitan re-leer contenido). */
interface BibFileCacheEntry {
  mtime: number;
  size: number;
  hash: string;
}

export type BibFileCache = Record<string, BibFileCacheEntry>;

/** Hash del contenido de un archivo de bibliografía, reutilizando el caché si mtime+size coinciden. */
async function hashBibFile(abs: string, prevCache: BibFileCache | undefined, cache: BibFileCache): Promise<string> {
  try {
    const stat = await Bun.file(abs).stat();
    const mtime = Math.round(stat.mtimeMs);
    const size = stat.size;
    const prev = prevCache?.[abs];
    if (prev && prev.mtime === mtime && prev.size === size) {
      cache[abs] = prev;
      return prev.hash;
    }
    const content = await Bun.file(abs).text();
    const hash = hashString(content);
    cache[abs] = { mtime, size, hash };
    return hash;
  } catch {
    // Archivo ausente/ilegible: hash de contenido vacío (mismo comportamiento anterior)
    const empty = hashString('');
    cache[abs] = { mtime: 0, size: 0, hash: empty };
    return empty;
  }
}

/**
 * Hash del contenido de los archivos de bibliografía efectivos (los que el
 * pipeline realmente usa). Con `bibliography` configurada: esa ruta y el CSL
 * configurado. Sin configurar: todos los .bib/.csl del proyecto (la capa
 * LaTeX referencia todos los .bib descubiertos).
 *
 * Con `prevCache` (de state.json), cada archivo se compara por mtime+size:
 * si no cambió, se reutiliza su hash sin leer el contenido.
 */
export async function computeBibHash(cwd: string, siteConfig?: SiteConfig, prevCache?: BibFileCache): Promise<{ hash: string; cache: BibFileCache }> {
  const parts: string[] = [];
  const cache: BibFileCache = {};
  const files: string[] = [];
  const configuredBib = siteConfig?.bibliography?.trim();
  if (configuredBib) {
    files.push(resolveConfiguredPath(cwd, configuredBib));
    const configuredCsl = siteConfig?.csl?.trim();
    if (configuredCsl) files.push(resolveConfiguredPath(cwd, configuredCsl));
  } else {
    files.push(...(await discoverBibFiles(cwd)));
  }
  for (const file of files) {
    parts.push(file, await hashBibFile(file, prevCache, cache));
  }
  return { hash: hashString(parts.join('\0')), cache };
}

/** Resuelve una ruta configurada (bibliography/csl) contra la raíz del proyecto. */
function resolveConfiguredPath(cwd: string, rel: string): string {
  return isAbsolute(rel) ? rel : join(cwd, rel);
}

/**
 * Resuelve las opciones de bibliografía compartidas para exportaciones.
 * Con `bibliography` configurada (raíz de la config) se usa esa ruta y el CSL
 * configurado (o el APA-7 empaquetado). Sin configurar: auto-descubrimiento
 * del primer .bib del proyecto con APA-7.
 * Si la ruta configurada no existe, se advierte y se vuelve al comportamiento
 * de auto-descubrimiento (mismo patrón que lua-filters inexistentes).
 */
export async function resolveBibOptions(cwd: string, siteConfig?: SiteConfig): Promise<{ bibFiles: string[]; bibOptions?: BibOptions }> {
  const configuredBib = siteConfig?.bibliography?.trim();
  if (configuredBib) {
    const bibPath = resolveConfiguredPath(cwd, configuredBib);
    if (await Bun.file(bibPath).exists()) {
      const configuredCsl = siteConfig?.csl?.trim();
      const cslPath = configuredCsl ? resolveConfiguredPath(cwd, configuredCsl) : join(import.meta.dir, '../../src/lib/resources/apa-7.csl');
      return { bibFiles: [bibPath], bibOptions: { bibliography: bibPath, csl: cslPath } };
    }
    logWarning(`bibliography: "${configuredBib}" no encontrado en el proyecto; se usa el auto-descubrimiento`, 'config');
  }
  const bibFiles = cwd ? await discoverBibFiles(cwd, ['bib']) : [];
  const firstBib = bibFiles[0];
  const bibOptions = firstBib !== undefined ? { bibliography: firstBib, csl: join(import.meta.dir, '../../src/lib/resources/apa-7.csl') } : undefined;
  return { bibFiles, bibOptions };
}
