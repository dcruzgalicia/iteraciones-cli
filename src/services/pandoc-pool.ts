import { createServer } from 'node:net';
import { PandocError } from '../errors.js';

/** Pide al SO un puerto libre usando la asignación automática con port 0. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address !== null && typeof address === 'object') {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('No se pudo obtener el puerto asignado')));
      }
    });
    server.on('error', reject);
  });
}

/** Sondea el endpoint /version de pandoc-server hasta que responde o se agotan los intentos. */
async function waitForServer(port: number, maxRetries = 30, intervalMs = 100): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/version`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return true;
    } catch {
      // Servidor todavía no disponible; esperar antes del siguiente intento.
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Pool de un proceso `pandoc-server` que elimina el fork overhead de pandoc en
 * builds con muchos documentos. El servidor Warp maneja concurrencia internamente,
 * por lo que un solo proceso es suficiente.
 *
 * Usar `PandocPool.tryCreate()` para instanciar: retorna `null` si
 * `pandoc-server` no está disponible, lo que permite un fallback transparente
 * al modo stdin (un proceso por conversión).
 */
export class PandocPool {
  readonly #port: number;
  readonly #proc: ReturnType<typeof Bun.spawn>;

  private constructor(port: number, proc: ReturnType<typeof Bun.spawn>) {
    this.#port = port;
    this.#proc = proc;
  }

  /**
   * Intenta iniciar un proceso `pandoc-server` en un puerto libre.
   * Retorna `null` si `pandoc-server` no está instalado o no arranca en el
   * tiempo de espera.
   */
  static async tryCreate(): Promise<PandocPool | null> {
    let port: number;
    try {
      port = await findFreePort();
    } catch {
      return null;
    }

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(['pandoc-server', '--port', String(port)], {
        stdout: 'ignore',
        stderr: 'ignore',
      });
    } catch {
      return null;
    }

    const ready = await waitForServer(port);
    if (!ready) {
      proc.kill();
      return null;
    }

    return new PandocPool(port, proc);
  }

  /**
   * Convierte contenido Markdown a HTML5 enviando una petición a pandoc-server.
   *
   * @param markdown  Contenido Markdown a convertir.
   * @param sourcePath  Ruta del archivo fuente (solo para mensajes de error).
   */
  async convert(markdown: string, sourcePath: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${this.#port}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          text: markdown,
          from: 'markdown',
          to: 'html5',
          standalone: false,
          'syntax-highlighting': 'none',
        }),
      });
    } catch (err) {
      throw new PandocError(`pandoc-server no respondió al convertir "${sourcePath}": ${String(err)}`, sourcePath, '');
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new PandocError(`pandoc-server: respuesta no JSON (status ${res.status}) al convertir "${sourcePath}"`, sourcePath, '');
    }
    if (typeof raw !== 'object' || raw === null) {
      throw new PandocError(`pandoc-server: respuesta inválida para "${sourcePath}"`, sourcePath, '');
    }
    const json = raw as Record<string, unknown>;
    const error = json['error'];
    const output = json['output'];

    if (!res.ok || typeof error === 'string') {
      const errMsg = typeof error === 'string' ? error : `HTTP ${res.status}`;
      throw new PandocError(`pandoc-server falló al convertir "${sourcePath}": ${errMsg}`, sourcePath, errMsg);
    }

    if (typeof output !== 'string') {
      throw new PandocError(`pandoc-server: campo 'output' ausente o inválido al convertir "${sourcePath}"`, sourcePath, '');
    }
    return output;
  }

  /** Detiene el proceso pandoc-server. */
  dispose(): void {
    this.#proc.kill();
  }
}
