import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { resolveDisabledPreambleConfig } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { DESCRIPCIONES_PREAMBLE } from './filter-descriptions.js';

export type PreambleDocType = 'file' | 'collection' | 'creator' | 'intervention';

const PKG_PREAMBLE_DIR = join(import.meta.dir, '../lib/resources/preamble');
const PKG_PREAMBLE_COLLECTION_DIR = join(import.meta.dir, '../lib/resources/preamble-collection');
const PKG_PREAMBLE_CREATOR_DIR = join(import.meta.dir, '../lib/resources/preamble-creator');
const PKG_PREAMBLE_INTERVENTION_DIR = join(import.meta.dir, '../lib/resources/preamble-intervention');

function preamblePkgDir(docType: PreambleDocType): string {
  if (docType === 'collection') return PKG_PREAMBLE_COLLECTION_DIR;
  if (docType === 'creator') return PKG_PREAMBLE_CREATOR_DIR;
  if (docType === 'intervention') return PKG_PREAMBLE_INTERVENTION_DIR;
  return PKG_PREAMBLE_DIR;
}

function preambleProjectDir(docType: PreambleDocType): string {
  if (docType === 'collection') return 'preamble-collection';
  if (docType === 'creator') return 'preamble-creator';
  if (docType === 'intervention') return 'preamble-intervention';
  return 'preamble';
}

export function projectPreambleDirs(): string[] {
  const types: PreambleDocType[] = ['file', 'collection', 'creator', 'intervention'];
  return types.map(preambleProjectDir);
}

let builtinPreambleNames: string[] | null = null;

export function getBuiltinPreambleFilterNames(): string[] {
  if (builtinPreambleNames === null) {
    builtinPreambleNames = [...new Bun.Glob('*.tex').scanSync({ cwd: PKG_PREAMBLE_DIR, onlyFiles: true })]
      .sort()
      .map((file) => file.replace(/\.tex$/, ''));
  }
  return builtinPreambleNames;
}

export interface PreambleFilter {
  name: string;
  content: string;
}

interface PreambleFilterInfo {
  name: string;
  description: string;
}

export async function loadPreambleFilters(disabledList?: string[], cwd?: string, docType: PreambleDocType = 'file'): Promise<PreambleFilter[]> {
  const excluded = new Set(disabledList ?? []);
  const result: PreambleFilter[] = [];
  const pkgDir = preamblePkgDir(docType);
  const projectDir = preambleProjectDir(docType);

  for (const name of getBuiltinPreambleFilterNames()) {
    if (excluded.has(name)) continue;
    const projectPath = join(cwd ?? '', projectDir, `${name}.tex`);
    const pkgPath = join(pkgDir, `${name}.tex`);
    const path = cwd && (await Bun.file(projectPath).exists()) ? projectPath : pkgPath;
    const content = await Bun.file(path).text();
    result.push({ name, content });
  }

  return result;
}

export function resolveDisabledPreambleForBuild(siteConfig: SiteConfig, bibFiles: string[] | undefined): string[] {
  return disableBibliographyWithoutBibFiles(resolveEffectiveDisabledPreamble(resolveDisabledPreambleConfig(siteConfig)), bibFiles);
}

export function resolveEffectiveDisabledPreamble(disabled?: string[]): string[] {
  const effective = disabled ? [...disabled] : [];
  const effectiveSet = new Set(effective);
  if (!effectiveSet.has('99-pdfx') && !effectiveSet.has('08-hyperref')) {
    effective.push('08-hyperref');
    logWarning('08-hyperref desactivado automáticamente: 99-pdfx requiere enlaces desactivados (PDF/X-1a)', 'config');
  }
  return effective;
}

export function disableBibliographyWithoutBibFiles(disabled: string[], bibFiles: string[] | undefined): string[] {
  if (bibFiles === undefined || bibFiles.length > 0 || disabled.includes('11-bibliography')) return disabled;
  return [...disabled, '11-bibliography'];
}

export async function getBuiltinPreambleFilterInfos(): Promise<PreambleFilterInfo[]> {
  return getBuiltinPreambleFilterNames().map((name) => ({ name, description: DESCRIPCIONES_PREAMBLE[name] ?? '' }));
}

export function validateDisabledPreambleFilters(disabled: string[] | undefined): void {
  if (!disabled || disabled.length === 0) return;
  const unknown: string[] = [];
  for (const name of disabled) {
    if (!getBuiltinPreambleFilterNames().includes(name)) unknown.push(name);
  }
  if (unknown.length > 0) {
    throw new BuildError(`disabledPreambleFilters: "${unknown.join(', ')}" no coincide con ningún preamble filter`);
  }
}

type PreambleDependencyIssue = { severity: 'error' | 'warning'; message: string };

export function validatePreambleDependencies(disabled: string[] | undefined): PreambleDependencyIssue[] {
  const issues: PreambleDependencyIssue[] = [];
  if (!disabled || disabled.length === 0) return issues;
  const disabledSet = new Set(disabled);
  if (!disabledSet.has('16-toc-styling') && disabledSet.has('05-language')) {
    issues.push({
      severity: 'error',
      message:
        '16-toc-styling usa \\renewcaptionname (definido por babel): desactivar 05-language rompe el índice del PDF. Desactiva también 16-toc-styling.',
    });
  }
  return issues;
}
