import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { resolveDisabledPreambleConfig } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { DESCRIPCIONES_PREAMBLE } from './filter-descriptions.js';

export type PreambleDocType = 'file' | 'collection' | 'creator' | 'intervention';

export const PKG_PREAMBLE_DIR = join(import.meta.dir, '../lib/resources/preamble');
const PROJECT_PREAMBLE_DIR = 'preamble';

const PREAMBLE_DIRS: Record<PreambleDocType, { pkg?: string; project: string }> = {
  file: { pkg: PKG_PREAMBLE_DIR, project: PROJECT_PREAMBLE_DIR },
  collection: { pkg: join(import.meta.dir, '../lib/resources/preamble-collection'), project: 'preamble-collection' },
  creator: { pkg: join(import.meta.dir, '../lib/resources/preamble-creator'), project: 'preamble-creator' },
  intervention: { project: 'preamble-intervention' },
};

export function projectPreambleDirs(): string[] {
  return Object.values(PREAMBLE_DIRS).map((dirs) => dirs.project);
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

async function primeraQueExista(candidatas: string[]): Promise<string | undefined> {
  for (const path of candidatas) {
    if (await Bun.file(path).exists()) return path;
  }
  return undefined;
}

export async function loadPreambleFilters(disabledList?: string[], cwd?: string, docType: PreambleDocType = 'file'): Promise<PreambleFilter[]> {
  const excluded = new Set(disabledList ?? []);
  const result: PreambleFilter[] = [];
  const { pkg, project } = PREAMBLE_DIRS[docType];

  for (const name of getBuiltinPreambleFilterNames()) {
    if (excluded.has(name)) continue;
    const delPaqueteBase = join(PKG_PREAMBLE_DIR, `${name}.tex`);
    const candidatas = [
      ...new Set([
        ...(cwd === undefined ? [] : [join(cwd, project, `${name}.tex`)]),
        ...(pkg === undefined ? [] : [join(pkg, `${name}.tex`)]),
        ...(cwd === undefined ? [] : [join(cwd, PROJECT_PREAMBLE_DIR, `${name}.tex`)]),
        delPaqueteBase,
      ]),
    ];
    const elegida = (await primeraQueExista(candidatas)) ?? delPaqueteBase;
    const content = await Bun.file(elegida).text();
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
