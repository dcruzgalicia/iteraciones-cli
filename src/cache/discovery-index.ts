import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Frontmatter } from '../loader/frontmatter.js';

export interface DiscoveryEntry {
  /** Timestamp de última modificación del archivo en ms (usado para validar la entrada). */
  mtimeMs: number;
  /** SHA-256 hex del contenido del archivo (frontmatter + body). */
  sourceHash: string;
  /** Frontmatter parseado del archivo. */
  frontmatter: Frontmatter;
  /** Cuerpo del archivo (sin bloque frontmatter). */
  body: string;
}

/** Mapa de relativePath → DiscoveryEntry. */
export type DiscoveryIndex = Map<string, DiscoveryEntry>;

const DISCOVERY_INDEX_PATH = join('.iteraciones', 'cache', 'discovery.json');

/**
 * Carga el índice de discovery desde `.iteraciones/cache/discovery.json`.
 * Retorna un Map vacío si el archivo no existe o es inválido.
 */
export async function loadDiscoveryIndex(cwd: string): Promise<DiscoveryIndex> {
  const file = Bun.file(join(cwd, DISCOVERY_INDEX_PATH));
  if (!(await file.exists())) return new Map();

  try {
    const raw = await file.text();
    const parsed: Record<string, DiscoveryEntry> = JSON.parse(raw);
    return new Map(Object.entries(parsed));
  } catch {
    // Índice corrupto: iniciar vacío
    return new Map();
  }
}

/**
 * Persiste el índice de discovery en `.iteraciones/cache/discovery.json`.
 */
export async function saveDiscoveryIndex(cwd: string, index: DiscoveryIndex): Promise<void> {
  const filePath = join(cwd, DISCOVERY_INDEX_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  const obj: Record<string, DiscoveryEntry> = Object.fromEntries(index);
  await Bun.write(filePath, JSON.stringify(obj));
}
