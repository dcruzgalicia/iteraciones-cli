import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Crea el directorio padre si no existe y escribe `content` en `filePath`.
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, content);
}

/**
 * Crea el directorio `dirPath` (y sus padres) si no existe.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Elimina `dirPath` completo y lo recrea vacío. No falla si no existe.
 */
export async function clean(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
  await mkdir(dirPath, { recursive: true });
}
