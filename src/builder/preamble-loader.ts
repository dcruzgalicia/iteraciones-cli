import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { resolveDisabledPreambleConfig } from '../config/site-config.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';

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

/** #2448: overrides de preamble en la raíz, uno por tipo; `bundle` los replica. */
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

/**
 * La lista efectiva de preámbulos desactivados, con la regla #2419 ya aplicada.
 * El build la compone en dos pasos (orchestrator da la base, pipeline-setup
 * aplica la regla del .bib); `iteraciones template` necesita las dos juntas, y
 * es la segunda copia que hay de esa composición.
 */
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

/**
 * #2419 — sin archivos `.bib` no hay nada que citar: se apaga el snippet
 * `11-bibliography` (csquotes + biblatex), con lo que la plantilla no carga
 * biblatex y latexmk no tiene nada que pasarle a biber. Si la lista ya venía
 * con el nombre, o si no sabemos si hay `.bib` (`bibFiles` desconocido), no se
 * toca nada.
 *
 * La comparten build, `iteraciones template` e `iteraciones filters` para que
 * las tres digan lo mismo (el .sh regenera las plantillas con `template`).
 */
export function disableBibliographyWithoutBibFiles(disabled: string[], bibFiles: string[] | undefined): string[] {
  if (bibFiles === undefined || bibFiles.length > 0 || disabled.includes('11-bibliography')) return disabled;
  return [...disabled, '11-bibliography'];
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
