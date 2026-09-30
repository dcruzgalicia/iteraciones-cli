import { PACKAGED_APA7_CSL } from './state-bib.js';

export function metadataValue(value: string): string {
  return value.replace(/\n/g, ' ');
}

export function titleArg(title: string): string {
  return `--metadata=title:${metadataValue(title)}`;
}

export function languageArg(language: string, key: 'language' | 'lang' = 'language'): string {
  return `--metadata=${key}:${language}`;
}

export function creatorArgs(creator: string[]): string[] {
  return creator.map((c) => `--metadata=creator:${metadataValue(c)}`);
}

export function dateArg(date: string | undefined): string[] {
  return date !== undefined ? [`--metadata=date:${metadataValue(date)}`] : [];
}

export function publisherArg(publishers: string[]): string[] {
  return publishers.map((p) => `--metadata=publishers:${metadataValue(p)}`);
}

export function citationCompileArgs(bibliography: string | undefined, csl: string | undefined): string[] {
  if (!bibliography) return [];
  return ['--citeproc', '--bibliography', bibliography, '--csl', csl ?? PACKAGED_APA7_CSL];
}
