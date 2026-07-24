import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface DiscoveryEntry {
  title: string;
  author: string[];
}

/** Mapa de relativePath → { title, author }. */
export type DiscoveryIndex = Map<string, DiscoveryEntry>;

interface DiscoveryIndexFile {
  cliVersion: string;
  entries: Record<string, DiscoveryEntry>;
}

const DISCOVERY_INDEX_PATH = join('.iteraciones', 'changes', 'files.json');

async function readCliVersion(): Promise<string> {
  try {
    const pkg = (await Bun.file(join(import.meta.dir, '../../package.json')).json()) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

export async function loadDiscoveryIndex(cwd: string): Promise<DiscoveryIndex> {
  const file = Bun.file(join(cwd, DISCOVERY_INDEX_PATH));
  if (!(await file.exists())) return new Map();

  try {
    const raw = await file.text();
    const parsed: DiscoveryIndexFile = JSON.parse(raw);
    const currentVersion = await readCliVersion();
    if (parsed.cliVersion !== currentVersion) return new Map();
    return new Map(Object.entries(parsed.entries));
  } catch {
    return new Map();
  }
}

export async function saveDiscoveryIndex(cwd: string, index: DiscoveryIndex): Promise<void> {
  const filePath = join(cwd, DISCOVERY_INDEX_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  const cliVersion = await readCliVersion();
  const file: DiscoveryIndexFile = { cliVersion, entries: Object.fromEntries(index) };
  await Bun.write(filePath, JSON.stringify(file));
}
