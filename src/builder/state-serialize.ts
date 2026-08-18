import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logWarning } from '../lib/logger.js';
import type { BibFileCache } from './state-bib.js';
import type { FilterFileCache } from './state-hash.js';
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
    return {
      startedAt: parsed.startedAt,
      activeFormats: Array.isArray(parsed.activeFormats) ? parsed.activeFormats : [],
      outputDir: parsed.outputDir,
      filtersHash: parsed.filtersHash,
      filterFileCache: parsed.filterFileCache,
      configHashes: parsed.configHashes,
      bibHash: parsed.bibHash,
      bibFileCache: parsed.bibFileCache,
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
 * Marca el estado persistido como build completo. Se llama al final de un
 * build exitoso: el estado que escribió discover (sin flag) pasa a ser válido
 * como caché para el siguiente build. No escribe si el estado no existe o ya
 * está completo (el camino "sin cambios" no debe tocar el disco).
 */
export async function markStateCompleted(cwd: string): Promise<void> {
  const state = await loadStateFile(cwd);
  if (!state || state.completed === true) return;
  state.completed = true;
  await saveStateFile(cwd, state);
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
 * Actualiza el cssHash y la caché por archivo de HTML del estado persistido
 * (el resto lo escribió discover con el índice actual). No escribe si nada
 * cambió.
 */
export async function updateCssHash(cwd: string, cssHash: string, cssFileCache?: CssFileCache): Promise<void> {
  const state = await loadStateFile(cwd);
  if (!state) return;
  if (state.cssHash === cssHash && (cssFileCache === undefined || JSON.stringify(state.cssFileCache) === JSON.stringify(cssFileCache))) {
    return;
  }
  state.cssHash = cssHash;
  if (cssFileCache !== undefined) state.cssFileCache = cssFileCache;
  await saveStateFile(cwd, state);
}
