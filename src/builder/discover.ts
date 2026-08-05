import { mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import slugifyLib from 'slugify';
import { formatUserError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import { resolveSlugs } from './slug-resolver.js';
import { type FilterFileCache, hashString, loadStateFile, saveStateFile } from './state.js';
import type { BuildDocument, DiscoveryEntry } from './types.js';

interface DiscoverResult {
  relativePaths: string[];
  changedPaths: Set<string>;
  discoveryIndex: Map<string, DiscoveryEntry>;
  /** Entradas de archivos eliminados (title/author/slug para calcular slugs). */
  deletedEntries: Map<string, DiscoveryEntry>;
  /** Archivos cuyo slug cambio (relativePath -> slug anterior). */
  slugChangedEntries: Map<string, string>;
}

/**
 * Estado del build anterior, leído de state.json.
 * Combina el report (startedAt, activeFormats) con el discovery index (entries)
 * y los hashes de invalidación (filters, config por formato, bibliografía).
 */
export interface BuildState {
  /** Timestamp del build anterior. */
  startedAt: number;
  /** Formatos que estaban activos en el build anterior. */
  activeFormats: string[];
  /** Hash de los filters efectivos del build anterior. */
  filtersHash?: string;
  /** Caché de archivos de filtro del build anterior (mtime+size+hash). */
  filterFileCache?: FilterFileCache;
  /** Hash de los inputs del CSS del build anterior. */
  cssInputHash?: string;
  /** Hash de configuración por formato del build anterior. */
  configHashes?: Record<string, string>;
  /** Hash de los .bib/.csl del build anterior. */
  bibHash?: string;
  /** Entradas del discovery index (path → frontmatter + caché content-addressed). */
  entries: Map<string, DiscoveryEntry>;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export async function loadBuildState(cwd: string): Promise<BuildState | null> {
  const state = await loadStateFile(cwd);
  if (!state) return null;
  return {
    startedAt: state.startedAt,
    activeFormats: state.activeFormats,
    filtersHash: state.filtersHash,
    filterFileCache: state.filterFileCache,
    cssInputHash: state.cssInputHash,
    configHashes: state.configHashes,
    bibHash: state.bibHash,
    entries: new Map(Object.entries(state.entries)),
  };
}

/**
 * Guarda el estado del build actual en state.json (escritura atómica).
 * Combina el report (startedAt, activeFormats), los hashes de invalidación
 * y el discovery index (entries).
 */
export async function saveBuildState(cwd: string, state: BuildState): Promise<void> {
  await saveStateFile(cwd, {
    startedAt: state.startedAt,
    activeFormats: state.activeFormats,
    filtersHash: state.filtersHash,
    filterFileCache: state.filterFileCache,
    cssInputHash: state.cssInputHash,
    configHashes: state.configHashes,
    bibHash: state.bibHash,
    entries: Object.fromEntries(state.entries),
  });
}

/**
 * Separa el frontmatter YAML del body del documento.
 * Única implementación del parser: discover la usa para el YAML y render
 * para obtener el body sin frontmatter (sin strip duplicado).
 */
export function splitFrontmatter(content: string): { yaml?: string; body: string } {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { body: content };
  return { yaml: fmMatch[1], body: content.slice(fmMatch[0].length) };
}

/**
 * Convierte un texto a slug URL-safe. Usa la librería slugify (con `strict`
 * elimina lo que no sea [a-z0-9] y con `lower` normaliza a minúsculas);
 * maneja caracteres acentuados, ß→ss y símbolos (&→and, %→percent).
 */
function slugify(text: string): string {
  return slugifyLib(text, { lower: true, strict: true });
}

/**
 * Calcula el slug de un documento desde su frontmatter: `title[-by-author]`.
 * Si no hay title y se provee `fallbackPath`, usa el nombre del archivo
 * (sin extensión .md) como base: `filename[-by-author]`.
 * Sin title ni fallbackPath, retorna undefined.
 */
export function computeSlug(frontmatter: { title?: string; author?: string[] }): string | undefined;
export function computeSlug(frontmatter: { title?: string; author?: string[] }, options: { fallbackPath: string }): string;
export function computeSlug(frontmatter: { title?: string; author?: string[] }, options?: { fallbackPath?: string }): string | undefined {
  const authors = frontmatter.author?.filter(Boolean).slice(0, 3);

  const base = frontmatter.title ? slugify(frontmatter.title) : options?.fallbackPath ? slugify(basename(options.fallbackPath, '.md')) : undefined;
  if (!base) return undefined;

  if (!authors || authors.length === 0) return base;

  const authorSlug = authors.map((a) => slugify(a)).join('-y-');
  return `${base}-by-${authorSlug}`;
}

/**
 * Fase 1 — discover: detecta cambios y actualiza el estado del build.
 * Si se proporciona prevState (desde orchestrator), evita la segunda
 * lectura de state.json.
 *
 * Detección de cambios content-addressed (por archivo):
 *   mtime y size iguales al caché  → unchanged (sin leer, sin hash)
 *   size distinto                  → changed (no hace falta hash)
 *   mtime distinto con size igual  → leer + sha256
 *     hash igual al caché          → unchanged (fue un touch) → actualizar mtime
 *     hash distinto                → changed
 */
export async function discover(
  cwd: string,
  options: {
    noCache?: boolean;
    activeFormats?: string[];
    prevState?: BuildState | null;
    /** Hashes de invalidación calculados por el orchestrator, guardados en state.json. */
    meta?: { filtersHash: string; filterFileCache: FilterFileCache; configHashes: Record<string, string>; bibHash: string; cssInputHash: string };
  } = {},
): Promise<DiscoverResult> {
  const relativePaths: string[] = [];

  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    relativePaths.push(entry);
  }

  relativePaths.sort();

  const useCache = !options.noCache;
  // Si orchestrator ya pasó el estado, no leer state.json otra vez
  const prevState = options.prevState !== undefined ? options.prevState : useCache ? await loadBuildState(cwd) : null;
  const discoveryIndex = useCache ? (prevState?.entries ?? new Map<string, DiscoveryEntry>()) : new Map<string, DiscoveryEntry>();

  const currentSet = new Set(relativePaths);
  const changedPaths = new Set<string>();
  const recentFiles: string[] = [];
  const deletedFiles: string[] = [];
  const slugChangedEntries = new Map<string, string>();

  const thisBuildStartedAt = Date.now();

  // Detectar cambios por archivo con caché content-addressed (mtime+size+hash)
  const FILE_IO_CONCURRENCY = Math.max(1, cpus().length - 1);
  await mapWithConcurrency(relativePaths, FILE_IO_CONCURRENCY, async (relativePath) => {
    const filePath = join(cwd, relativePath);
    let mtimeMs: number;
    let size: number;
    try {
      const stat = await Bun.file(filePath).stat();
      mtimeMs = stat.mtimeMs;
      size = stat.size;
    } catch (err) {
      throw new Error(`Error al leer "${relativePath}": ${String(err)}`, { cause: err });
    }
    const mtime = Math.round(mtimeMs);
    const cached = useCache ? discoveryIndex.get(relativePath) : undefined;
    const cacheValid = cached !== undefined && cached.mtime !== undefined && cached.size !== undefined && cached.hash !== undefined;

    let needsProcessing = !cacheValid;
    let text: string | null = null;

    if (cacheValid) {
      if (mtime === cached.mtime && size === cached.size) {
        // UNCHANGED: mismo mtime y tamaño → sin leer, sin hash (~stat puro)
        needsProcessing = false;
      } else if (size !== cached.size) {
        // CHANGED: el tamaño cambió → no hace falta hash
        needsProcessing = true;
      } else {
        // AMBIGUO: mtime cambió pero el tamaño es igual → leer + sha256
        text = await Bun.file(filePath).text();
        if (hashString(text) === cached.hash) {
          // Fue un touch (o una copia con el mismo contenido): sin reprocesar
          needsProcessing = false;
          cached.mtime = mtime;
        } else {
          needsProcessing = true;
        }
      }
    }

    if (needsProcessing) {
      changedPaths.add(relativePath);
      recentFiles.push(relativePath);

      // Leer contenido (una sola vez) para hash + frontmatter
      if (text === null) {
        try {
          text = await Bun.file(filePath).text();
        } catch (err) {
          throw new Error(`Error al leer "${relativePath}": ${String(err)}`, { cause: err });
        }
      }
      const hash = hashString(text);

      // Read YAML frontmatter
      let title = '',
        subtitle: string | undefined,
        date: string | undefined,
        authors: string[] = [];
      try {
        const { yaml } = splitFrontmatter(text);
        if (yaml) {
          const parsed = Bun.YAML.parse(yaml) as Record<string, unknown>;
          if (parsed && !Array.isArray(parsed)) {
            title = typeof parsed.title === 'string' ? parsed.title : '';
            subtitle = typeof parsed.subtitle === 'string' && parsed.subtitle.trim() ? parsed.subtitle.trim() : undefined;
            date = typeof parsed.date === 'string' && parsed.date.trim() ? parsed.date.trim() : undefined;
            authors = parseAuthors(parsed.author);
          }
        }
      } catch (err) {
        // frontmatter YAML inválido: mantener datos anteriores y advertir para que el usuario lo corrija
        logWarning(`frontmatter YAML inválido en "${relativePath}": ${formatUserError(err)}`, 'discover');
      }

      if (!title) {
        logWarning(`"${relativePath}" no tiene título en el frontmatter; se usará "Sin título"`, 'discover');
      }

      // Store base data (slug resolution happens later, after all files are processed)
      // Preservar el slug anterior en la entrada para que resolveSlugs detecte el
      // cambio contra el slug final: comparar por prefijos aquí falla cuando el slug
      // nuevo es prefijo del viejo (quitar author, acortar título, sufijo -dN).
      const prevSlug = discoveryIndex.get(relativePath)?.slug;
      discoveryIndex.set(relativePath, { title, subtitle, author: authors, date, mtime, size, hash, slug: prevSlug });
    }
    // Archivos sin cambios: conservan su entrada en discoveryIndex
  });

  // Detectar eliminados y capturar sus datos antes de borrarlos
  const deletedEntries = new Map<string, DiscoveryEntry>();
  for (const key of discoveryIndex.keys()) {
    if (!currentSet.has(key)) {
      changedPaths.add(key);
      deletedFiles.push(key);
      const entry = discoveryIndex.get(key);
      if (entry) deletedEntries.set(key, entry); // entry now has slug!
    }
  }

  // Limpiar discoveryIndex de archivos eliminados
  for (const p of deletedFiles) {
    discoveryIndex.delete(p);
  }

  // Resolver slugs via slug-resolver
  const slugResult = await resolveSlugs(cwd, discoveryIndex, (meta, opts) => computeSlug(meta, opts as { fallbackPath: string }));
  for (const [path, oldSlug] of slugResult.slugChangedEntries) slugChangedEntries.set(path, oldSlug);
  for (const path of slugResult.changedPaths) changedPaths.add(path);
  for (const path of slugResult.newRecentFiles) {
    if (!recentFiles.includes(path)) recentFiles.push(path);
  }

  // Solo persistir state.json si hubo cambios (archivos nuevos/modificados/eliminados
  // o los hashes de invalidación cambiaron). En builds sin cambios, evitar I/O innecesario.
  const hasChanged =
    changedPaths.size > 0 ||
    !useCache ||
    options.meta?.filtersHash !== prevState?.filtersHash ||
    JSON.stringify(options.meta?.filterFileCache) !== JSON.stringify(prevState?.filterFileCache) ||
    JSON.stringify(options.meta?.configHashes) !== JSON.stringify(prevState?.configHashes) ||
    options.meta?.bibHash !== prevState?.bibHash ||
    options.meta?.cssInputHash !== prevState?.cssInputHash;

  if (hasChanged) {
    await saveBuildState(cwd, {
      startedAt: thisBuildStartedAt,
      activeFormats: options.activeFormats ?? [],
      entries: discoveryIndex,
      filtersHash: options.meta?.filtersHash,
      filterFileCache: options.meta?.filterFileCache,
      cssInputHash: options.meta?.cssInputHash,
      configHashes: options.meta?.configHashes,
      bibHash: options.meta?.bibHash,
    });
  }

  return { relativePaths, changedPaths, discoveryIndex, deletedEntries, slugChangedEntries };
}

/** Directorios que el CLI ignora al escanear el proyecto. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);

/**
 * Construye BuildDocument[] con frontmatter desde discoveryIndex.
 * Solo title y author — el resto usa valores por defecto.
 */
export function buildDocsFromIndex(relativePaths: string[], discoveryIndex: Map<string, DiscoveryEntry>, cwd: string): BuildDocument[] {
  return relativePaths.map((relativePath) => {
    const entry = discoveryIndex.get(relativePath);
    return {
      filePath: join(cwd, relativePath),
      relativePath,
      frontmatter: {
        title: entry?.title || 'Sin t\u00edtulo',
        subtitle: entry?.subtitle,
        date: entry?.date ?? '',
        author: entry?.author ?? [],
      },
    };
  });
}

/**
 * Parsea el campo author del frontmatter. Acepta tanto string simple
 * como array de strings; filtra valores que no sean texto y retorna un
 * array vacío si el campo está ausente, es nulo o está vacío.
 */
export function parseAuthors(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((a: unknown): a is string => typeof a === 'string');
  }
  if (typeof raw === 'string' && raw.trim()) {
    return [raw.trim()];
  }
  return [];
}
