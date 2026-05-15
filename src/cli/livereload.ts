import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Script minificado que se inyecta en cada HTML para conectar con el
 * endpoint SSE y recargar la página cuando el servidor lo notifique.
 */
export const LIVERELOAD_SCRIPT = `
<script>
(function () {
  var es = new EventSource('/__livereload');
  es.onmessage = function () { location.reload(); };
  es.onerror = function () { es.close(); };
})();
</script>
`;

type SseClient = { res: ServerResponse };

/**
 * Crea un broadcaster SSE: gestiona el conjunto de clientes conectados,
 * atiende las peticiones al endpoint `/__livereload` y envía notificaciones
 * de recarga a todos los clientes activos.
 */
export function createLivereloadBroadcaster(): {
  handleRequest: (req: IncomingMessage, res: ServerResponse) => void;
  notify: () => void;
} {
  const clients = new Set<SseClient>();

  function handleRequest(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Comentario SSE inicial para mantener la conexión abierta en Safari.
    res.write(':\n\n');
    const client: SseClient = { res };
    clients.add(client);
    _req.on('close', () => clients.delete(client));
  }

  function notify(): void {
    for (const client of clients) {
      try {
        client.res.write('data: reload\n\n');
      } catch {
        clients.delete(client);
      }
    }
  }

  return { handleRequest, notify };
}
