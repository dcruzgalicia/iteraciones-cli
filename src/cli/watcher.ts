import { watch as fsWatch } from 'node:fs';
import { extname } from 'node:path';

const WATCHED_EXTENSIONS = new Set(['.md', '.html', '.css', '.yaml', '.yml']);
// Prefijos que se ignoran para evitar bucles infinitos al modificar dist/ o la caché.
const IGNORED_PREFIXES = ['dist', '.iteraciones'];
const DEBOUNCE_MS = 300;

/**
 * Observa `srcDir` en busca de cambios en ficheros fuente relevantes.
 * Aplica debounce de 300 ms. Si llega un cambio mientras hay un rebuild
 * activo, lo acumula en `pendingFiles` y lanza un nuevo rebuild al terminar.
 * Ningún evento se descarta.
 *
 * @param srcDir Directorio raíz a vigilar (recursivo).
 * @param onChange Callback async que recibe el conjunto de ficheros cambiados.
 *                 El watcher acumula nuevos eventos hasta que el callback resuelve.
 * @returns Función que detiene el watcher y cancela el timer pendiente.
 */
export function startWatcher(srcDir: string, onChange: (files: Set<string>) => Promise<void>): () => void {
  let pendingFiles = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let buildPromise: Promise<void> | null = null;

  const scheduleRebuild = (): void => {
    if (buildPromise !== null) return; // ya hay un rebuild activo; los pendingFiles se acumulan
    const files = pendingFiles;
    pendingFiles = new Set<string>();
    buildPromise = onChange(files).finally(() => {
      buildPromise = null;
      if (pendingFiles.size > 0) scheduleRebuild(); // había cambios mientras corría
    });
  };

  const watcher = fsWatch(srcDir, { recursive: true }, (_, filename) => {
    if (!filename) return;

    // Ignorar cambios en directorios de salida para evitar bucles infinitos.
    // Se compara el primer segmento para no filtrar archivos como `distilled.md`.
    if (IGNORED_PREFIXES.some((prefix) => filename === prefix || filename.startsWith(prefix + '/'))) return;

    const ext = extname(filename).toLowerCase();
    if (!WATCHED_EXTENSIONS.has(ext)) return;

    pendingFiles.add(filename);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scheduleRebuild, DEBOUNCE_MS);
  });

  return () => {
    clearTimeout(debounceTimer);
    watcher.close();
  };
}
