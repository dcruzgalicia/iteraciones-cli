import { stat, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { listMarkdownDocuments } from '../builder/discover-files.js';
import { resolveBibOptions } from '../builder/state-bib.js';
import { projectFilterSpecs } from '../builder/state-hash.js';
import { loadSiteConfigIfPresent } from '../config/config-loader.js';
import { logInfo } from '../lib/logger.js';
import { runBuild } from './dispatcher.js';

// ponytail: O(n) mtimes cada 200 ms, como el watcher de polling de quarto (~5 ms / 200 archivos).
// fs.watch tiene eventos perdidos y no sobrevive a los editores que salvan con rename atómico.
const POLL_MS = 200;

const LOCK_PATH = join('.iteraciones', 'preview.lock');

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type Snapshot = Map<string, number>;

/**
 * Los archivos cuyo cambio obliga a reconstruir. La lista explícita es lo que evita el loop
 * infinito de rebuilds: dist/ nunca está en ella, así que no hay lista de ignorados que mantener.
 */
export async function previewInputs(cwd: string): Promise<string[]> {
  const entradas: string[] = [join(cwd, 'iteraciones.config.yaml'), ...(await listMarkdownDocuments(cwd)).map((rel) => join(cwd, rel))];

  // si la config está rota no hay bibliografía que descubrir, pero el build va a reportar el error:
  // el preview no debe morir por eso
  const loaded = await loadSiteConfigIfPresent(cwd).catch(() => null);
  if (loaded) entradas.push(...(await resolveBibOptions(cwd, loaded.config).catch(() => ({ bibFiles: [] }))).bibFiles);

  for (const [dir, glob] of projectFilterSpecs(cwd)) {
    // los directorios de filters y preámbulo son opcionales: si no existen, no hay nada que vigilar
    try {
      for await (const file of new Bun.Glob(glob).scan({ cwd: dir })) entradas.push(join(dir, file));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  return [...new Set(entradas.filter(Boolean))];
}

async function mtimeDe(ruta: string): Promise<number> {
  try {
    return Math.round((await stat(ruta)).mtimeMs);
  } catch {
    return 0;
  }
}

export async function takeSnapshot(entradas: string[]): Promise<Snapshot> {
  const snap: Snapshot = new Map();
  for (const ruta of entradas) snap.set(ruta, await mtimeDe(ruta));
  return snap;
}

/**
 * Los archivos que cambiaron o desaparecieron desde el snapshot anterior.
 * Se recorre la unión de ambas listas: un archivo borrado ya no está en `actual`, y sin la unión
 * su salida pasaría desapercibida (mtime 0 contra el valor previo).
 */
export function changedSince(previo: Snapshot, actual: Snapshot): string[] {
  return [...new Set([...previo.keys(), ...actual.keys()])].filter((ruta) => previo.get(ruta) !== actual.get(ruta));
}

function pidVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface PreviewLock {
  release: () => Promise<void>;
}

/** Un preview por proyecto: el pid anterior recibe SIGTERM y el lock se borra al salir. */
export async function acquirePreviewLock(cwd: string, onNotice?: (msg: string) => void): Promise<PreviewLock> {
  const lockfile = join(cwd, LOCK_PATH);
  const previo = await Bun.file(lockfile)
    .text()
    .catch(() => '');
  const pidAnterior = Number.parseInt(previo.trim(), 10);

  if (Number.isInteger(pidAnterior) && pidAnterior > 0 && pidAnterior !== process.pid && pidVivo(pidAnterior)) {
    onNotice?.(`terminando el preview anterior (pid ${pidAnterior})`);
    try {
      process.kill(pidAnterior, 'SIGTERM');
    } catch {}
    for (let intento = 0; intento < 15 && pidVivo(pidAnterior); intento++) await sleep(200);
  }

  await Bun.write(lockfile, String(process.pid));
  return {
    release: async () => {
      await unlink(lockfile).catch(() => {});
    },
  };
}

export interface PreviewOptions {
  only?: string[];
  verbose?: boolean;
  pollMs?: number;
}

export async function runPreview(cwd: string, options: PreviewOptions = {}): Promise<void> {
  const pollMs = options.pollMs ?? POLL_MS;
  const build = { only: options.only, verbose: options.verbose };

  // el handler se registra antes del primer await: si la señal llega mientras se toma el
  // snapshot inicial, sin esto se pierde y el preview no se puede parar
  let snapshot = new Map<string, number>();
  let corriendo = false;
  let pendiente = false;
  let seguir = true;
  const parar = () => {
    seguir = false;
  };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);

  const lock = await acquirePreviewLock(cwd, (msg) => logInfo(msg, 'preview'));

  // un flag en vez de la PromiseQueue de quarto: hay un solo productor de builds
  const ciclo = async (): Promise<void> => {
    if (corriendo) {
      pendiente = true;
      return;
    }
    corriendo = true;
    try {
      do {
        pendiente = false;
        process.exitCode = 0; // runBuild deja exitCode=1 si falla; en preview envenena la salida final
        await runBuild(cwd, build);
      } while (pendiente && seguir);
    } finally {
      corriendo = false;
    }
  };

  try {
    snapshot = await takeSnapshot(await previewInputs(cwd));
    await ciclo();
    logInfo('vigilando cambios; Ctrl+C para salir', 'preview');
    while (seguir) {
      await sleep(pollMs);
      const actual = await takeSnapshot(await previewInputs(cwd));
      const cambios = changedSince(snapshot, actual);
      snapshot = actual;
      if (cambios.length > 0) {
        const extra = cambios.length - 1;
        logInfo(`cambio: ${relative(cwd, cambios[0] as string)}${extra > 0 ? ` (+${extra})` : ''}`, 'preview');
        await ciclo();
      }
    }
  } finally {
    process.off('SIGINT', parar);
    process.off('SIGTERM', parar);
    await lock.release();
  }
}
