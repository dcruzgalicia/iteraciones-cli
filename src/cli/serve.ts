import { join } from 'node:path';
import { build } from '../builder/orchestrator.js';
import { createHttpServer } from './http-server.js';
import { createLivereloadBroadcaster, LIVERELOAD_SCRIPT } from './livereload.js';
import { startWatcher } from './watcher.js';

/**
 * Arranca un servidor HTTP local que sirve `dist/web` e inyecta el script de
 * livereload en cada respuesta HTML. Observa los ficheros fuente en `cwd` y
 * dispara un rebuild + notificación SSE cuando detecta cambios relevantes.
 *
 * @param cwd Directorio raíz del proyecto (donde está `_iteraciones.yaml`).
 * @param port Puerto en el que escucha el servidor (default 3000).
 * @returns Función que detiene el servidor y el watcher al ser llamada.
 */
export async function runServe(cwd: string, port: number): Promise<() => void> {
  const distDir = join(cwd, 'dist/web');

  // ── Build inicial ──────────────────────────────────────────────────────────
  process.stdout.write('serve: build inicial…\n');
  try {
    await build(cwd);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`serve: el build inicial falló — el servidor no puede arrancar.\n  ${message}`, { cause: err });
  }

  // ── Broadcaster SSE ────────────────────────────────────────────────────────
  const broadcaster = createLivereloadBroadcaster();

  // ── Servidor HTTP ──────────────────────────────────────────────────────────
  const server = createHttpServer(distDir, broadcaster.handleRequest, (html) =>
    html.includes('</body>') ? html.replace('</body>', `${LIVERELOAD_SCRIPT}</body>`) : html + LIVERELOAD_SCRIPT,
  );

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      process.stdout.write(`serve: escuchando en http://localhost:${port}\n`);
      resolve();
    });
  });

  // ── Watcher con debounce ───────────────────────────────────────────────────
  const stopWatcher = startWatcher(cwd, async (filename) => {
    process.stdout.write(`serve: cambio detectado en "${filename}" — reconstruyendo…\n`);
    try {
      await build(cwd);
      process.stdout.write('serve: rebuild completado\n');
      broadcaster.notify();
    } catch (err: unknown) {
      process.stdout.write(`serve: error en rebuild — ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });

  return () => {
    stopWatcher();
    server.close();
  };
}
