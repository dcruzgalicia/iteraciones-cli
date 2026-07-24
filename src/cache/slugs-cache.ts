import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Contador de sufijos -dN para slugs duplicados.
 *  key: "slug" (raiz) o "dir/slug" (subdirectorio)
 *  value: maximo -dN asignado hasta ahora */
export type SlugsCounter = Map<string, number>;

const CACHE_PATH = join('.iteraciones', 'changes', 'slugs.json');

export async function loadSlugsCounter(cwd: string): Promise<SlugsCounter> {
  const file = Bun.file(join(cwd, CACHE_PATH));
  if (!(await file.exists())) return new Map();
  try {
    const raw = await file.text();
    const parsed: Record<string, number> = JSON.parse(raw);
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export async function saveSlugsCounter(cwd: string, counter: SlugsCounter): Promise<void> {
  const filePath = join(cwd, CACHE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(Object.fromEntries(counter)));
}
