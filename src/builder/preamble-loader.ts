import { join } from 'node:path';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';

export type PreambleDocType = 'file' | 'collection';

const PKG_PREAMBLE_DIR = join(import.meta.dir, '../lib/resources/preamble');
const PKG_PREAMBLE_COLLECTION_DIR = join(import.meta.dir, '../lib/resources/preamble-collection');

function preamblePkgDir(docType: PreambleDocType): string {
  return docType === 'collection' ? PKG_PREAMBLE_COLLECTION_DIR : PKG_PREAMBLE_DIR;
}

function preambleProjectDir(docType: PreambleDocType): string {
  return docType === 'collection' ? 'preamble-collection' : 'preamble';
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

export function resolveEffectiveDisabledPreamble(disabled?: string[]): string[] {
  const effective = disabled ? [...disabled] : [];
  const effectiveSet = new Set(effective);
  if (!effectiveSet.has('99-pdfx') && !effectiveSet.has('08-hyperref')) {
    effective.push('08-hyperref');
    logWarning('08-hyperref desactivado automáticamente: 99-pdfx requiere enlaces desactivados (PDF/X-1a)', 'config');
  }
  return effective;
}

function readPreambleDescription(content: string): string {
  const lines: string[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('%')) {
      lines.push(line.replace(/^%\s*/, '').trim());
    } else if (lines.length > 0) {
      break;
    }
  }
  return lines.filter(Boolean).join(' ');
}

export async function getBuiltinPreambleFilterInfos(): Promise<PreambleFilterInfo[]> {
  const infos: PreambleFilterInfo[] = [];
  for (const name of getBuiltinPreambleFilterNames()) {
    const content = await Bun.file(join(PKG_PREAMBLE_DIR, `${name}.tex`)).text();
    infos.push({ name, description: readPreambleDescription(content) });
  }
  return infos;
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
