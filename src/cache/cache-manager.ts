import type { Dirent } from 'node:fs';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export type CacheScope = 'render' | 'compose';

/**
 * Gestiona la caché incremental en disco bajo `{cwd}/.iteraciones/cache/`.
 *
 * Estructura de directorios:
 *   .iteraciones/cache/{scope}/{key[0..1]}/{key}
 *
 * Los dos primeros caracteres de la clave (hex SHA-256) se usan como
 * subdirectorio para distribuir los archivos, al igual que los objetos de git.
 */
export class CacheManager {
  readonly #baseDir: string;

  constructor(cwd: string) {
    this.#baseDir = join(cwd, '.iteraciones', 'cache');
  }

  /**
   * Valida que `key` sea un hash SHA-256 en hexadecimal de 64 caracteres.
   * Lanza si la clave no cumple el formato para prevenir path traversal.
   */
  static #validateKey(key: string): void {
    if (!/^[0-9a-f]{64}$/.test(key)) {
      throw new Error(`CacheManager: clave inválida "${key}". Se esperaba SHA-256 hexadecimal de 64 caracteres.`);
    }
  }

  /**
   * Lee el valor almacenado para la clave dada en el scope indicado.
   * Retorna `undefined` si la entrada no existe.
   */
  async read(scope: CacheScope, key: string): Promise<string | undefined> {
    CacheManager.#validateKey(key);
    const file = Bun.file(this.#entryPath(scope, key));
    if (!(await file.exists())) return undefined;
    return file.text();
  }

  /**
   * Escribe `value` en la entrada identificada por `scope` y `key`.
   * Crea los directorios intermedios si no existen.
   */
  async write(scope: CacheScope, key: string, value: string): Promise<void> {
    CacheManager.#validateKey(key);
    const dir = this.#entryDir(scope, key);
    await mkdir(dir, { recursive: true });
    await Bun.write(this.#entryPath(scope, key), value);
  }

  /**
   * Elimina todas las entradas del `scope` cuya clave no esté en `activeKeys`.
   * Los subdirectorios vacíos resultantes no se eliminan (coste insignificante).
   */
  async prune(scope: CacheScope, activeKeys: Set<string>): Promise<void> {
    const scopeDir = join(this.#baseDir, scope);
    let buckets: Dirent[];
    try {
      buckets = await readdir(scopeDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }

    // Procesar buckets secuencialmente para evitar EMFILE con cachés grandes.
    for (const bucket of buckets) {
      if (!bucket.isDirectory()) continue;
      const bucketDir = join(scopeDir, bucket.name);
      let entries: Dirent[];
      try {
        entries = await readdir(bucketDir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
      await Promise.all(
        entries
          .filter((e) => e.isFile() && !activeKeys.has(e.name))
          .map(async (e) => {
            try {
              await unlink(join(bucketDir, e.name));
            } catch (err) {
              // Ignorar si el archivo fue eliminado concurrentemente.
              if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
            }
          }),
      );
    }
  }

  #entryDir(scope: CacheScope, key: string): string {
    return join(this.#baseDir, scope, key.slice(0, 2));
  }

  #entryPath(scope: CacheScope, key: string): string {
    return join(this.#entryDir(scope, key), key);
  }
}
