/**
 * Genera un digest SHA-256 en hexadecimal a partir de uno o más valores string.
 * Todos los valores se concatenan antes de procesar, lo que permite derivar
 * claves de caché compuestas (p.ej. markdown + frontmatter + versión del CLI).
 */
export function hash(...values: string[]): string {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const value of values) {
    hasher.update(value);
  }
  return hasher.digest('hex');
}
