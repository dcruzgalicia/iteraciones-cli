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

/** Estructura completa del índice de discovery persistido en disco. */
interface DiscoveryIndexFile {
  /** Versión del CLI que creó el índice. Si difiere, el índice se descarta. */
  cliVersion: string;
  entries: Record<string, DiscoveryEntry>;
}

/** Mapa de relativePath → DiscoveryEntry. */
export type DiscoveryIndex = Map<string, DiscoveryEntry>;

const DISCOVERY_INDEX_PATH = join('.iteraciones', 'cache', 'discovery.json');

async function readCliVersion(): Promise<string> {
  try {
    const pkg = (await Bun.file(join(import.meta.dir, '../../package.json')).json()) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/**
 * Carga el índice de discovery desde `.iteraciones/cache/discovery.json`.
 * Retorna un Map vacío si el archivo no existe, es inválido, o fue generado
 * con una versión diferente del CLI.
 */
export async function loadDiscoveryIndex(cwd: string): Promise<DiscoveryIndex> {
  const file = Bun.file(join(cwd, DISCOVERY_INDEX_PATH));
  if (!(await file.exists())) return new Map();

  try {
    const raw = await file.text();
    const parsed: DiscoveryIndexFile = JSON.parse(raw);
    const currentVersion = await readCliVersion();
    // Si la versión del CLI cambió, el parser puede haber variado → descartar.
    if (parsed.cliVersion !== currentVersion) return new Map();
    return new Map(Object.entries(parsed.entries));
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
  const cliVersion = await readCliVersion();
  const file: DiscoveryIndexFile = { cliVersion, entries: Object.fromEntries(index) };
  await Bun.write(filePath, JSON.stringify(file));
}
