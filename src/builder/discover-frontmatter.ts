import { BUILD_ERROR_CODES, BuildError, formatUserError, translateSystemError } from '../lib/errors.js';
import { parseYamlWithPosition, splitFrontmatter } from '../lib/frontmatter.js';
import { fmStringList, fmTrimmedString } from '../lib/frontmatter-fields.js';
import { logWarning } from '../lib/logger.js';
import { plural } from '../lib/plural.js';
import { looseColonLines, looseColonsMessage, MISSING_TITLE_WARNING, validateFrontmatterFields } from './project-validator.js';
import { hashString } from './state-serialize.js';
import type { DiscoveryEntry } from './types.js';

export type FrontmatterIssue = { file: string; error: string; kind: 'syntax' | 'field' };

export interface IngestedFrontmatter {
  title: string;
  subtitle: string | undefined;
  date: string | undefined;
  creator: string[];
  manualSlug: string | undefined;
  type: 'file' | 'collection' | undefined;
  files: string[] | undefined;
  fm: Record<string, unknown> | undefined;
}

interface NormalizedRecord extends Omit<IngestedFrontmatter, 'fm'> {
  rawTitle: unknown;
}

function normalizeFrontmatterRecord(record: Record<string, unknown>, relativePath: string, issues: FrontmatterIssue[]): NormalizedRecord {
  for (const issue of validateFrontmatterFields(record)) {
    if (issue.severity === 'error') {
      issues.push({ file: relativePath, error: issue.message, kind: 'field' });
    } else {
      logWarning(`${relativePath}: ${issue.message}`, 'discover');
    }
  }
  const rawTitle = record.title;
  const type = record.type === 'file' || record.type === 'collection' ? record.type : undefined;
  const files = Array.isArray(record.files) && record.files.every((f) => typeof f === 'string') ? (record.files as string[]) : undefined;
  return {
    title: typeof rawTitle === 'string' ? rawTitle : '',
    subtitle: fmTrimmedString(record.subtitle),
    date: fmTrimmedString(record.date),
    creator: parseAuthors(record.creator),
    manualSlug: fmTrimmedString(record.slug),
    type,
    files,
    rawTitle,
  };
}

function lacksTitle(normalized: NormalizedRecord | undefined, title: string): boolean {
  return !title && (!normalized || normalized.rawTitle === undefined || normalized.rawTitle === '');
}

function parseFrontmatter(relativePath: string, text: string, issues: FrontmatterIssue[]): IngestedFrontmatter {
  const { yaml, body } = splitFrontmatter(text);
  let normalized: NormalizedRecord | undefined;
  let fm: Record<string, unknown> | undefined;

  try {
    if (yaml) {
      const yamlResult = parseYamlWithPosition(yaml);
      if (yamlResult.error) throw new Error(yamlResult.error);
      const parsed = yamlResult.value;
      if (parsed && Array.isArray(parsed)) {
        issues.push({ file: relativePath, error: 'frontmatter YAML inválido: debe ser un objeto', kind: 'syntax' });
      } else if (parsed && typeof parsed === 'object') {
        fm = parsed as Record<string, unknown>;
        normalized = normalizeFrontmatterRecord(fm, relativePath, issues);
      }
    }
  } catch (err) {
    issues.push({ file: relativePath, error: formatUserError(err), kind: 'syntax' });
  }

  const lineOffset = text.slice(0, text.length - body.length).split('\n').length - 1;
  const looseColons = looseColonLines(body, lineOffset);
  if (looseColons.length > 0) {
    logWarning(`${relativePath}: ${looseColonsMessage(looseColons)}`, 'discover');
  }

  const title = normalized?.title ?? '';
  if (lacksTitle(normalized, title)) {
    logWarning(`${relativePath}: ${MISSING_TITLE_WARNING.message}`, 'discover');
  }

  return {
    title,
    subtitle: normalized?.subtitle,
    date: normalized?.date,
    creator: normalized?.creator ?? [],
    manualSlug: normalized?.manualSlug,
    type: normalized?.type,
    files: normalized?.files,
    fm,
  };
}

async function readDocumentText(filePath: string, relativePath: string, pending: string | null): Promise<string> {
  if (pending !== null) return pending;
  try {
    return await Bun.file(filePath).text();
  } catch (err) {
    throw new BuildError(`Error al leer "${relativePath}": ${translateSystemError(err, 'verifica que el nombre del archivo sea correcto')}`);
  }
}

export async function parseDocument(args: {
  cwd: string;
  relativePath: string;
  filePath: string;
  mtime: number;
  size: number;
  cachedSlug: string | undefined;
  decisionText: string | null;
  decisionHash: string | undefined;
  index: Map<string, DiscoveryEntry>;
  issues: FrontmatterIssue[];
}): Promise<void> {
  const { relativePath, filePath, mtime, size, decisionText, decisionHash } = args;
  const text = await readDocumentText(filePath, relativePath, decisionText);
  const ingested = parseFrontmatter(relativePath, text, args.issues);
  args.index.set(relativePath, {
    ...ingested,
    mtime,
    size,
    hash: decisionHash ?? hashString(text),
    slug: args.cachedSlug,
  });
}

export function throwIfInvalidFrontmatter(issues: FrontmatterIssue[]): void {
  if (issues.length === 0) return;
  const blocks: string[] = [];
  for (const kind of ['syntax', 'field'] as const) {
    const byKind = issues.filter((e) => e.kind === kind);
    if (byKind.length === 0) continue;
    const label = kind === 'syntax' ? 'frontmatter YAML inválido' : 'frontmatter inválido';
    const msg = byKind.map((e) => `  ${e.file}: ${e.error}`).join('\n');
    blocks.push(`${label} en ${plural(byKind.length, 'documento')}:\n${msg}`);
  }
  const hasSyntax = issues.some((e) => e.kind === 'syntax');
  throw new BuildError(blocks.join('\n'), hasSyntax ? BUILD_ERROR_CODES.frontmatterSyntax : undefined);
}

export function parseAuthors(raw: unknown): string[] {
  return fmStringList(raw) ?? [];
}
