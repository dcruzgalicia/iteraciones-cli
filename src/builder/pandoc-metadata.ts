import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { fmString } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { PACKAGED_APA7_CSL } from './state-bib.js';

export function metadataValue(value: string): string {
  return value.replace(/\n/g, ' ');
}

export function effectiveLanguage(fm: Record<string, unknown>, fallback: string): string {
  return fmString(fm.language, fallback);
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

export function citationCompileArgs(bibliography: string | undefined, csl: string | undefined): string[] {
  if (!bibliography) return [];
  return ['--citeproc', '--bibliography', bibliography, '--csl', csl ?? PACKAGED_APA7_CSL];
}

export function citationPortableMetadataArgs(bibliography: string | undefined, csl: string | undefined, cwd: string): string[] {
  const args: string[] = [];
  if (bibliography) args.push(`--metadata=bibliography:${relative(cwd, bibliography)}`);
  if (csl) {
    if (existsSync(csl)) args.push(`--metadata=csl:${relative(cwd, csl)}`);
    else logWarning(`archivo CSL no encontrado: "${csl}"`, 'export');
  }
  return args;
}
