import { join } from 'node:path';
import { exportSingleDocument } from '../builder/export/runner.js';
import { type BuildOptions, build, type OnDemandExportState } from '../builder/orchestrator.js';
import type { BuildDocument, DocumentType } from '../builder/types.js';
import { reportBuildError } from './build-errors.js';
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
export async function runServe(cwd: string, port: number, options: { concurrency?: number; verbose?: boolean } = {}): Promise<() => void> {
  const distDir = join(cwd, 'dist/web');
  // La exportación PDF/EPUB se desactiva siempre en modo serve: xelatex tarda
  // 15–60s por documento, haciendo los rebuilds inutilizables en watch mode.
  // Para generar exportaciones completas, usar `iteraciones build` fuera del serve.
  // La exportación on-demand individual se activa cuando el usuario navega a un .pdf.

  // Estado de exportación del último build: se actualiza tras cada rebuild.
  let currentExportState: OnDemandExportState | null = null;
  // Pool acumulativo de docs renderizados: se fusiona en cada build/rebuild para
  // preservar docs de tipos no afectados en builds incrementales. En un build
  // incremental, renderedMap solo contiene los docs re-renderizados; sin este
  // pool, una petición on-demand a un PDF no re-renderizado devolvería null.
  const accumulatedRenderedMap = new Map<DocumentType, BuildDocument[]>();

  const onExportStateReady = (state: OnDemandExportState): void => {
    // Fusionar renderedMap del build actual en el pool acumulativo:
    // - Para cada tipo, reemplazar solo los docs que aparecen en el nuevo mapa
    //   (por relativePath) y conservar los demás del pool anterior.
    // - En un build completo, newDocs contiene todos los docs del tipo y el
    //   resultado es equivalente a un reemplazo total.
    for (const [type, newDocs] of state.renderedMap) {
      const existing = accumulatedRenderedMap.get(type) ?? [];
      const newPaths = new Set(newDocs.map((d) => d.relativePath));
      accumulatedRenderedMap.set(type, [...existing.filter((d) => !newPaths.has(d.relativePath)), ...newDocs]);
    }
    currentExportState = { ...state, renderedMap: accumulatedRenderedMap };
  };

  const baseOpts: BuildOptions = {
    concurrency: options.concurrency,
    verbose: options.verbose,
    noExport: true,
    onExportStateReady,
  };
  const incrementalOpts: BuildOptions = { ...baseOpts, incremental: true };

  // ── Build inicial ───────────────────────────────────────────────────────────────────
  process.stdout.write('serve: build inicial… (exportación PDF/EPUB desactivada en watch mode)\n');
  try {
    currentExportState = null;
    await build(cwd, baseOpts);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`serve: el build inicial falló — el servidor no puede arrancar.\n  ${message}`, { cause: err });
  }

  // ── Broadcaster SSE ────────────────────────────────────────────────────────
  const broadcaster = createLivereloadBroadcaster();

  // ── Servidor HTTP ──────────────────────────────────────────────────────────
  const server = createHttpServer(
    distDir,
    broadcaster.handleRequest,
    (html) => (html.includes('</body>') ? html.replace('</body>', `${LIVERELOAD_SCRIPT}</body>`) : html + LIVERELOAD_SCRIPT),
    async (pdfRelPath: string): Promise<string | null> => {
      if (!currentExportState) return null;
      return exportSingleDocument(pdfRelPath, currentExportState.renderedMap, currentExportState.exportOptions);
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err) => {
      server.close();
      reject(err);
    });
    server.listen(port, () => {
      process.stdout.write(`serve: escuchando en http://localhost:${port}\n`);
      resolve();
    });
  });

  // ── Watcher con debounce ───────────────────────────────────────────────────
  const stopWatcher = startWatcher(cwd, async (changedFiles) => {
    const list = [...changedFiles].join(', ');
    process.stdout.write(`serve: cambio detectado en ${list} — reconstruyendo…\n`);
    try {
      currentExportState = null;
      await build(cwd, { ...incrementalOpts, changedPaths: changedFiles });
      process.stdout.write('serve: rebuild completado\n');
      broadcaster.notify();
    } catch (err: unknown) {
      reportBuildError(err, 'serve');
    }
  });

  return () => {
    stopWatcher();
    server.close();
  };
}
