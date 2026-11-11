import { stat, unlink } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { listMarkdownDocuments } from '../builder/discover-files.js';
import { DIST_FILES_DIR } from '../builder/output-layout.js';
import { resolveBibOptions } from '../builder/state-bib.js';
import { projectFilterSpecs } from '../builder/state-hash.js';
import { loadSiteConfigIfPresent } from '../config/config-loader.js';
import { logInfo, logWarning } from '../lib/logger.js';
import { runBuild } from './dispatcher.js';

const POLL_MS = 200;

const LOCK_PATH = join('.iteraciones', 'preview.lock');

const PREVIEW_PORT = 4321;

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.epub': 'application/epub+zip',
};

const RELOAD_SCRIPT = '<script>(()=>{const s=new EventSource("/_preview/events");s.onmessage=()=>location.reload();})();</script>';

export interface PreviewServer {
  url: string;
  reload: () => void;
  stop: () => void;
}

function inyectarRecarga(html: string): string {
  return html.includes('</body>') ? html.replace('</body>', `${RELOAD_SCRIPT}</body>`) : `${html}${RELOAD_SCRIPT}`;
}

export function startPreviewServer(cwd: string, outputDir = join(cwd, DIST_FILES_DIR), port = PREVIEW_PORT): PreviewServer {
  const root = resolve(outputDir);
  const adminRoot = resolve(cwd, 'admin');
  const clientes = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();

  const avisarRecarga = (): void => {
    for (const cliente of clientes) {
      try {
        cliente.enqueue(encoder.encode(`data: ${Date.now()}\n\n`));
      } catch {
        clientes.delete(cliente);
      }
    }
  };

  const resolverArchivo = async (pathname: string): Promise<string | undefined> => {
    const relativa = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const candidatos: Array<{ base: string; relativa: string }> = [{ base: root, relativa }];
    if (relativa.startsWith('/admin/')) candidatos.push({ base: adminRoot, relativa: relativa.slice('/admin'.length) });
    for (const { base, relativa: ruta } of candidatos) {
      const archivo = resolve(base, `.${ruta}`);
      if (archivo !== base && !archivo.startsWith(`${base}${sep}`)) continue;
      if (await Bun.file(archivo).exists()) return archivo;
    }
    return undefined;
  };

  const opciones = (puerto: number): Bun.Serve.Options<undefined> => ({
    port: puerto,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/_preview/events') {
        let controlador: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controlador = c;
            clientes.add(c);
            c.enqueue(encoder.encode(': conectado\n\n'));
          },
          cancel() {
            clientes.delete(controlador);
          },
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' },
        });
      }

      if (url.pathname === '/admin') return Response.redirect(`${url.origin}/admin/`, 302);

      const archivo = await resolverArchivo(decodeURIComponent(url.pathname));
      if (archivo === undefined) return new Response('No encontrado', { status: 404 });

      const headers = { 'Cache-Control': 'no-store' };
      if (extname(archivo) === '.html') {
        return new Response(inyectarRecarga(await Bun.file(archivo).text()), {
          headers: { ...headers, 'Content-Type': MIME_TYPES['.html'] as string },
        });
      }
      return new Response(Bun.file(archivo), {
        headers: { ...headers, 'Content-Type': MIME_TYPES[extname(archivo)] ?? 'application/octet-stream' },
      });
    },
  });

  const server = (() => {
    try {
      return Bun.serve(opciones(port));
    } catch (err) {
      if (port !== 0 && (err as NodeJS.ErrnoException).code === 'EADDRINUSE') return Bun.serve(opciones(0));
      throw err;
    }
  })();

  return {
    url: server.url.href,
    reload: avisarRecarga,
    stop: () => {
      for (const cliente of clientes) {
        try {
          cliente.close();
        } catch {}
      }
      clientes.clear();
      server.stop(true);
    },
  };
}

export type Snapshot = Map<string, number>;

export async function previewInputs(cwd: string): Promise<string[]> {
  const entradas: string[] = [join(cwd, 'iteraciones.config.yaml'), ...(await listMarkdownDocuments(cwd)).map((rel) => join(cwd, rel))];

  const loaded = await loadSiteConfigIfPresent(cwd).catch(() => null);
  if (loaded) entradas.push(...(await resolveBibOptions(cwd, loaded.config).catch(() => ({ bibFiles: [] }))).bibFiles);

  for (const [dir, glob] of projectFilterSpecs(cwd)) {
    try {
      for await (const file of new Bun.Glob(glob).scan({ cwd: dir })) entradas.push(join(dir, file));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  try {
    for await (const file of new Bun.Glob('admin/**/*').scan({ cwd })) entradas.push(join(cwd, file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
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

async function acquirePreviewLock(cwd: string, onNotice?: (msg: string) => void): Promise<() => Promise<void>> {
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
    for (let intento = 0; intento < 15 && pidVivo(pidAnterior); intento++) await Bun.sleep(200);
  }

  await Bun.write(lockfile, String(process.pid));
  return async () => {
    await unlink(lockfile).catch(() => {});
  };
}

interface PreviewOptions {
  only?: string[];
  verbose?: boolean;
  pollMs?: number;
  port?: number;
  serve?: boolean;
}

export async function runPreview(cwd: string, options: PreviewOptions = {}): Promise<void> {
  const pollMs = options.pollMs ?? POLL_MS;
  const build = { only: options.only, verbose: options.verbose };

  let snapshot = new Map<string, number>();
  let corriendo = false;
  let pendiente = false;
  let seguir = true;
  const parar = () => {
    seguir = false;
  };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);

  const release = await acquirePreviewLock(cwd, (msg) => logInfo(msg, 'preview'));

  const ciclo = async (): Promise<void> => {
    if (corriendo) {
      pendiente = true;
      return;
    }
    corriendo = true;
    try {
      do {
        pendiente = false;
        process.exitCode = 0;
        await runBuild(cwd, build);
      } while (pendiente && seguir);
    } finally {
      corriendo = false;
    }
  };

  let server: PreviewServer | undefined;
  try {
    snapshot = await takeSnapshot(await previewInputs(cwd));
    await ciclo();
    if (options.serve !== false) {
      try {
        server = startPreviewServer(cwd, join(cwd, DIST_FILES_DIR), options.port);
        logInfo(`servidor local: ${server.url}`, 'preview');
      } catch (err) {
        logWarning(`no se pudo iniciar el servidor local: ${err instanceof Error ? err.message : String(err)}`, 'preview');
      }
    }
    logInfo('vigilando cambios; Ctrl+C para salir', 'preview');
    while (seguir) {
      await Bun.sleep(pollMs);
      const actual = await takeSnapshot(await previewInputs(cwd));
      const cambios = changedSince(snapshot, actual);
      snapshot = actual;
      if (cambios.length > 0) {
        const extra = cambios.length - 1;
        logInfo(`cambio: ${relative(cwd, cambios[0] as string)}${extra > 0 ? ` (+${extra})` : ''}`, 'preview');
        await ciclo();
        server?.reload();
      }
    }
  } finally {
    process.off('SIGINT', parar);
    process.off('SIGTERM', parar);
    server?.stop();
    await release();
  }
}
