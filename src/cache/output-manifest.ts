import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Mapa de ruta relativa de origen → ruta absoluta de salida. */
export type OutputManifest = Map<string, string>;

const MANIFEST_PATH = join('.iteraciones', 'cache', 'output-manifest.json');

function manifestPath(cwd: string): string {
  return join(cwd, MANIFEST_PATH);
}

/** Lee el manifiesto desde disco. Devuelve un Map vacío si no existe o está corrupto. */
export async function loadOutputManifest(cwd: string): Promise<OutputManifest> {
  const file = Bun.file(manifestPath(cwd));
  const exists = await file.exists();
  if (!exists) return new Map();
  try {
    const raw = await file.text();
    const entries: unknown = JSON.parse(raw);
    if (
      !Array.isArray(entries) ||
      !entries.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string')
    ) {
      return new Map();
    }
    return new Map(entries as [string, string][]);
  } catch {
    return new Map();
  }
}

/** Persiste el manifiesto en disco. */
export async function saveOutputManifest(cwd: string, manifest: OutputManifest): Promise<void> {
  const path = manifestPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const entries = [...manifest.entries()];
  await Bun.write(path, JSON.stringify(entries));
}
