import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logWarning } from '../lib/logger.js';
import type { BibFileCache } from './state-bib.js';
import type { FilterFileCache } from './state-hash.js';
import type { DiscoveryEntry } from './types.js';

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
 * Actualiza solo el cssHash del estado persistido (el resto lo escribió
 * discover con el índice actual). No escribe si el hash no cambió.
 */
export async function updateCssHash(cwd: string, cssHash: string): Promise<void> {
  const state = await loadStateFile(cwd);
  if (!state || state.cssHash === cssHash) return;
  state.cssHash = cssHash;
  await saveStateFile(cwd, state);
}
