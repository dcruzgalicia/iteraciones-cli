import { exec } from './run.js';

const memo = new Map<string, string>();

async function probe(bin: string, args: string[]): Promise<string> {
  const cached = memo.get(bin);
  if (cached !== undefined) return cached;
  let version: string;
  try {
    const result = await exec(bin, args, { timeoutMs: 10_000 });
    const first = (result.stdout.trim() || result.stderr.trim()).split('\n')[0]?.trim() ?? '';
    version = result.exitCode === 0 || result.exitCode === 1 ? first : '';
  } catch {
    version = '';
  }
  memo.set(bin, version);
  return version;
}

export function resetToolVersionCache(): void {
  memo.clear();
}

const PROBES = {
  magick: ['-version'],
  pdftoppm: ['-v'],
  latexmk: ['-v'],
  minify: ['--version'],
} as const;

export function toolVersion(tool: keyof typeof PROBES): Promise<string> {
  return probe(tool, [...PROBES[tool]]);
}
