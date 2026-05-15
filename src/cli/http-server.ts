import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/**
 * Crea un servidor HTTP que sirve ficheros estáticos desde `distDir`.
 *
 * - Las peticiones a `/__livereload` se delegan a `handleLivereload`.
 * - Las respuestas HTML pasan por `injectHtml` antes de enviarse al cliente.
 * - Previene path traversal verificando que la ruta resuelta esté dentro
 *   de `distDir` antes de leer cualquier fichero.
 *
 * @returns Instancia de `Server` (aún sin escuchar).
 */
export function createHttpServer(
  distDir: string,
  handleLivereload: (req: IncomingMessage, res: ServerResponse) => void,
  injectHtml: (html: string) => string,
): Server {
  const normalizedDist = resolve(distDir);

  return createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';

      if (url === '/__livereload') {
        handleLivereload(req, res);
        return;
      }

      let filePath = join(distDir, url.split('?')[0] ?? '/');

      // Previene path traversal: la ruta resuelta debe estar dentro de distDir.
      const normalizedFile = resolve(filePath);
      if (!normalizedFile.startsWith(normalizedDist + sep) && normalizedFile !== normalizedDist) {
        res.writeHead(400);
        res.end('Bad Request');
        return;
      }

      // Si apunta a un directorio, busca index.html.
      try {
        const st = await stat(filePath);
        if (st.isDirectory()) {
          filePath = join(filePath, 'index.html');
        }
      } catch {
        // El stat fallará si no existe; se manejará con 404 a continuación.
      }

      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 — ${relative(distDir, filePath)} no encontrado`);
        return;
      }

      const ext = extname(filePath).toLowerCase();
      const contentType = MIME[ext] ?? 'application/octet-stream';

      let content: Buffer;
      try {
        content = await readFile(filePath);
      } catch {
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });

      if (ext === '.html') {
        res.end(injectHtml(content.toString('utf8')));
      } else {
        res.end(content);
      }
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end('Internal Server Error');
    });
  });
}
