import { watch as fsWatch } from 'node:fs';
import { extname } from 'node:path';

const WATCHED_EXTENSIONS = new Set(['.md', '.html', '.css', '.yaml', '.yml']);
// Prefijos que se ignoran para evitar bucles infinitos al modificar dist/ o la caché.
const IGNORED_PREFIXES = ['dist', '.iteraciones'];
const DEBOUNCE_MS = 300;

/**
 * Observa `srcDir` en busca de cambios en ficheros fuente relevantes.
 * Aplica debounce de 300 ms y evita rebuilds concurrentes mediante un
 * flag de bloqueo: si ya hay un rebuild activo se descarta el evento.
 *
 * @param srcDir Directorio raíz a vigilar (recursivo).
 * @param onChange Callback async que recibe el nombre del fichero cambiado.
 *                 El watcher se bloquea hasta que el callback resuelve.
 * @returns Función que detiene el watcher y cancela el timer pendiente.
 */
export function startWatcher(srcDir: string, onChange: (filename: string) => Promise<void>): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const watcher = fsWatch(srcDir, { recursive: true }, (_, filename) => {
    if (!filename) return;

    // Ignorar cambios en directorios de salida para evitar bucles infinitos.
    if (IGNORED_PREFIXES.some((prefix) => filename.startsWith(prefix))) return;

    const ext = extname(filename).toLowerCase();
    if (!WATCHED_EXTENSIONS.has(ext)) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (running) return;
      running = true;
      onChange(filename).finally(() => {
        running = false;
      });
    }, DEBOUNCE_MS);
  });

  return () => {
    clearTimeout(debounceTimer);
    watcher.close();
  };
}
