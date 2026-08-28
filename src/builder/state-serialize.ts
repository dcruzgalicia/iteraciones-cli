import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logWarning } from '../lib/logger.js';
import type { BibFileCache } from './state-bib.js';
import type { FilterFileCache } from './state-hash.js';

export type { BibFileCache, FilterFileCache };

import type { DiscoveryEntry } from './types.js';

/** Caché por archivo HTML de dist: mtime+size evitan re-leer contenido (mismo patrón que FilterFileCache). */
export type CssFileCache = Record<string, { mtime: number; size: number; hash: string }>;

/** Ruta relativa del archivo de estado del build dentro del proyecto. */
const STATE_PATH = join('.iteraciones', 'state.json');

/**
 * Estado del build (caché content-addressed), leído y guardado en state.json.
 * Combina el report (startedAt, activeFormats), el discovery index (entries)
 * y los hashes de invalidación (filters, config por formato, bibliografía).
 */
/** Versión del schema de state.json: incompatible ⇒ rebuild completo (una vez por bump). */
export const STATE_SCHEMA_VERSION = 2;

export interface BuildState {
  /** Versión del schema con la que se escribió el estado. */
  schemaVersion: number;
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
  /** Caché mtime+size de los archivos fuente de esquema (computeSchemaSourceHash, #2189). */
  schemaFileCache?: Record<string, import('./state-hash.js').FileCacheEntry>;
  /** Hash de configuración por formato (pdf, html, epub, markdown). */
  configHashes?: Record<string, string>;
  /** Caché mtime+size de recursos de config (recursos HTML, logo) (#2091). */
  configFileCache?: Record<string, import('./state-hash.js').FileCacheEntry>;
  /** Hash de los archivos .bib y .csl del proyecto. */
  bibHash?: string;
  /** Caché de certificaciones PDF/X válidas (clave compuesta #2190). */
  pdfxCache?: Record<string, string>;
  /** Caché por archivo de bibliografía (mtime+size+hash) para evitar re-leer contenido. */
  bibFileCache?: BibFileCache;
  /** Hash de los HTML finales + recursos CSS: invalida la compilación de Tailwind. */
  cssHash?: string;
  /** Caché por archivo HTML de dist (mtime+size+hash) para el cálculo del cssHash. */
  cssFileCache?: CssFileCache;

  /**
   * true solo si el build terminó limpiamente. Un estado sin este flag (o con
   * false) proviene de un build interrumpido (Ctrl-C, SIGKILL, corte de
   * energía): el build lo ignora y reprocesa todo (nunca reutiliza entradas
   * cuyo render nunca terminó).
   */
  completed?: boolean;
  /** Índice de descubrimiento: path relativo → entry con frontmatter y caché. */
  entries: Map<string, DiscoveryEntry>;
}

export function hashString(input: string): string {
  return Bun.CryptoHasher.hash('sha256', input, 'hex');
}

export async function hashFileContent(path: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return Bun.CryptoHasher.hash('sha256', bytes, 'hex');
}

export async function loadStateFile(cwd: string): Promise<BuildState | null> {
  const file = Bun.file(join(cwd, STATE_PATH));
  if (!(await file.exists())) return null;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<BuildState>;
    if (typeof parsed.startedAt !== 'number') return null;
    // Schema incompatible (estado de una versión anterior): rebuild completo
    if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) return null;
    return {
      schemaVersion: parsed.schemaVersion,
      startedAt: parsed.startedAt,
      activeFormats: Array.isArray(parsed.activeFormats) ? parsed.activeFormats : [],
      outputDir: parsed.outputDir,
      filtersHash: parsed.filtersHash,
      filterFileCache: parsed.filterFileCache,
      schemaFileCache: parsed.schemaFileCache,
      configHashes: parsed.configHashes,
      configFileCache: parsed.configFileCache,
      bibHash: parsed.bibHash,
      bibFileCache: parsed.bibFileCache,
      pdfxCache: parsed.pdfxCache,
      cssHash: parsed.cssHash,
      cssFileCache: parsed.cssFileCache,
      completed: parsed.completed,
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
 * Filtra el estado para el build: solo un estado con `completed: true` es
 * válido como caché incremental. Un estado sin flag (o con false) proviene de
 * un build interrumpido: retornar null fuerza el reprocesamiento completo.
 * Los consumidores informativos (doctor --info) leen el estado sin este
 * filtro; solo el build exige el flag.
 */
export function stateUsableForBuild(state: BuildState | null): BuildState | null {
  return state !== null && state.completed === true ? state : null;
}

/**
 * ÚNICA escritura de state.json por build (#2025): persiste el estado
 * pendiente que acumuló discovery + assets, marcado como completo. Se llama
 * desde el cierre común del orquestador; sin pendiente (build sin cambios)
 * no escribe — el estado en disco ya está completo y vigente.
 */
export async function persistCompletedState(cwd: string, pending: BuildState | null): Promise<void> {
  if (!pending || pending.completed === true) return;
  pending.completed = true;
  await saveStateFile(cwd, pending);
}

/**
 * Elimina el estado del build (tras un fallo): el siguiente build no tiene
 * índice de invalidación y reprocesa todo (nunca reutiliza contenido stale).
 */
export async function clearStateFile(cwd: string): Promise<void> {
  await rm(join(cwd, STATE_PATH), { force: true }).catch(() => {});
}

/**
 * Guarda state.json de forma atómica (temp + rename): un build interrumpido
 * nunca deja el caché a medias.
 */
export async function saveStateFile(cwd: string, state: BuildState): Promise<void> {
  const filePath = join(cwd, STATE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify({ ...state, schemaVersion: STATE_SCHEMA_VERSION, entries: Object.fromEntries(state.entries) }));
  try {
    await rename(tmpPath, filePath);
  } catch {
    // El destino ya existe en algunos sistemas (Windows): se elimina y se reintenta el rename
    await rm(filePath, { force: true });
    await rename(tmpPath, filePath);
  }
}
