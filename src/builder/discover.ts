import { mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, join } from 'node:path';
import slugifyLib from 'slugify';
import { logWarning } from '../lib/logger.js';
import { mapWithConcurrency } from '../lib/run.js';
import { hashString, loadStateFile, saveStateFile } from './state.js';
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
 * y los hashes de invalidación (transpilers, config por formato, bibliografía).
 */
export interface BuildState {
  /** Timestamp del build anterior. */
  startedAt: number;
  /** Formatos que estaban activos en el build anterior. */
  activeFormats: string[];
  /** Hash de los transpilers efectivos del build anterior. */
  transpilerHash?: string;
  /** Hash de configuración por formato del build anterior. */
  configHashes?: Record<string, string>;
  /** Hash de los .bib/.csl del build anterior. */
  bibHash?: string;
  /** Entradas del discovery index (path → frontmatter + caché content-addressed). */
  entries: Map<string, DiscoveryEntry>;
}

const SLUGS_CACHE_PATH = join('.iteraciones', 'changes', 'slugs.json');

/**
 * Carga el estado del build anterior desde state.json.
 * Retorna null si no existe (primer build).
 */
export async function loadBuildState(cwd: string): Promise<BuildState | null> {
  const state = await loadStateFile(cwd);
  if (!state) return null;
  return {
    startedAt: state.startedAt,
    activeFormats: state.activeFormats,
    transpilerHash: state.transpilerHash,
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
    transpilerHash: state.transpilerHash,
    configHashes: state.configHashes,
    bibHash: state.bibHash,
    entries: Object.fromEntries(state.entries),
  });
}

async function loadSlugsCounter(cwd: string): Promise<Map<string, number>> {
  const file = Bun.file(join(cwd, SLUGS_CACHE_PATH));
  if (!(await file.exists())) return new Map();
  try {
    const raw = await file.text();
    const parsed: Record<string, number> = JSON.parse(raw);
    return new Map(Object.entries(parsed));
  } catch (err) {
    logWarning(`no se pudo leer slugs.json; se reinicia el contador de slugs duplicados: ${String(err)}`, 'discover');
    return new Map();
  }
}

async function saveSlugsCounter(cwd: string, counter: Map<string, number>): Promise<void> {
  const filePath = join(cwd, SLUGS_CACHE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(Object.fromEntries(counter)));
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

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
    meta?: { transpilerHash: string; configHashes: Record<string, string>; bibHash: string };
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
            {
              const raw = parsed.author;
              authors = Array.isArray(raw)
                ? raw.filter((a: unknown): a is string => typeof a === 'string')
                : typeof raw === 'string' && raw.trim()
                  ? [raw.trim()]
                  : [];
            }
          }
        }
      } catch (err) {
        // frontmatter YAML inválido: mantener datos anteriores y advertir para que el usuario lo corrija
        logWarning(`frontmatter YAML inválido en "${relativePath}": ${String(err)}`, 'discover');
      }

      if (!title) {
        logWarning(`"${relativePath}" no tiene título en el frontmatter; se usará "Sin título"`, 'discover');
      }

      // Store base data (slug resolution happens later, after all files are processed)
      // Capturar slug anterior antes de sobrescribir (para limpiar archivos si cambia)
      const prevSlug = discoveryIndex.get(relativePath)?.slug;
      if (prevSlug) {
        const newSlugBase = computeSlug({ title, author: authors });
        if (newSlugBase && prevSlug !== newSlugBase && !prevSlug.startsWith(newSlugBase + '-')) {
          slugChangedEntries.set(relativePath, prevSlug);
        }
      }
      discoveryIndex.set(relativePath, { title, subtitle, author: authors, date, mtime, size, hash });
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

  // Resolver slugs duplicados: asignar -dN sin renumeracion
  const slugGroups = new Map<string, string[]>();
  for (const [relPath, entry] of discoveryIndex) {
    const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: relPath });
    const dir = dirname(relPath);
    const key = dir === '.' ? slugBase : dir + '/' + slugBase;
    if (!slugGroups.has(key)) slugGroups.set(key, []);
    slugGroups.get(key)!.push(relPath);
  }

  // Solo cargar contador de slugs si hay grupos duplicados
  const hasDuplicateGroups = [...slugGroups.values()].some((paths) => paths.length > 1);
  const slugsCounter = hasDuplicateGroups ? await loadSlugsCounter(cwd) : new Map<string, number>();

  for (const [key, paths] of slugGroups) {
    if (paths.length <= 1) {
      // No duplicates: assign base slug (sin -dN)
      const path = paths[0]!;
      const entry = discoveryIndex.get(path)!;
      const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: path });
      // Si antes tenia un slug con -dN y ahora es unico, forzar reprocesamiento
      if (entry.slug && entry.slug !== slugBase) {
        changedPaths.add(path);
        if (!recentFiles.includes(path)) recentFiles.push(path);
        slugChangedEntries.set(path, entry.slug);
      }
      entry.slug = slugBase;
    } else {
      // Duplicates: preservar -dN existentes, asignar maxN+1 a nuevos
      paths.sort();

      // Fase 1: preservar -dN de archivos existentes, calcular max N actual
      let maxN = slugsCounter.get(key) ?? 0;
      const existingSlugs = new Map<string, string>();
      for (const path of paths) {
        const entry = discoveryIndex.get(path)!;
        const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: path });
        if (entry.slug) {
          const m = entry.slug.match(/-d(\d+)$/);
          if (m) {
            const prefix = entry.slug.slice(0, -m[0].length);
            if (prefix === slugBase) {
              const n = parseInt(m[1]!, 10);
              if (n > maxN) maxN = n;
              existingSlugs.set(path, entry.slug);
            }
          }
        }
      }

      // Fase 2: asignar slugs para archivos sin -dN (nuevos o que cambiaron de slug base)
      let nextN = maxN + 1;
      for (const path of paths) {
        if (existingSlugs.has(path)) continue;
        const entry = discoveryIndex.get(path)!;
        const slugBase = computeSlug({ title: entry.title, author: entry.author }, { fallbackPath: path });
        const newSlug = slugBase + '-d' + nextN;
        // Si el slug existente cambio, forzar reprocesamiento y limpiar archivos viejos
        if (entry.slug && entry.slug !== newSlug) {
          changedPaths.add(path);
          if (!recentFiles.includes(path)) recentFiles.push(path);
          slugChangedEntries.set(path, entry.slug);
        }
        entry.slug = newSlug;
        nextN++;
      }

      // Actualizar contador con el maximo asignado
      slugsCounter.set(key, nextN - 1);
    }
  }

  // Guardar contador de slugs solo si hay grupos duplicados
  if (hasDuplicateGroups) {
    await saveSlugsCounter(cwd, slugsCounter);
  }

  await saveBuildState(cwd, {
    startedAt: thisBuildStartedAt,
    activeFormats: options.activeFormats ?? [],
    entries: discoveryIndex,
    transpilerHash: options.meta?.transpilerHash,
    configHashes: options.meta?.configHashes,
    bibHash: options.meta?.bibHash,
  });

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
