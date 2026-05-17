/**
 * Genera un digest SHA-256 en hexadecimal a partir de uno o más valores string.
 * Cada valor se separa con un byte nulo (\0) para evitar colisiones entre
 * concatenaciones distintas (p.ej. hash("ab","c") ≠ hash("a","bc")).
 */
export function hash(...values: string[]): string {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const value of values) {
    hasher.update(value);
    hasher.update('\0');
  }
  return hasher.digest('hex');
}
