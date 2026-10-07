import { PACKAGED_APA7_CSL } from './state-bib.js';

export interface MetadataEntry {
  key: string;
  value: string | string[] | undefined;
}

export function metadataArgs(entries: MetadataEntry[]): string[] {
  const args: string[] = [];
  for (const { key, value } of entries) {
    if (!value) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      args.push(`--metadata=${key}:${item.replace(/\n/g, ' ')}`);
    }
  }
  return args;
}

export function citationCompileArgs(bibliography: string | undefined, csl: string | undefined): string[] {
  if (!bibliography) return [];
  return ['--citeproc', '--bibliography', bibliography, '--csl', csl ?? PACKAGED_APA7_CSL];
}
