import { join } from 'node:path';
import ignore from 'ignore';

interface GitignoreRule {
  pattern: string;
  negated: boolean;
  anchored: boolean;
  dirOnly: boolean;
}

interface GitignoreRules extends Array<GitignoreRule> {
  __gitignoreMatcher?: ignore.Ignore;
}

const MATCHER_KEY = '__gitignoreMatcher';

function parseGitignoreLine(rawLine: string): GitignoreRule | undefined {
  let line = rawLine.trimEnd();
  if (!line || line.startsWith('#')) return undefined;

  let negated = false;
  if (line.startsWith('!')) {
    negated = true;
    line = line.slice(1);
  } else if (line.startsWith('\\!')) {
    line = line.slice(1);
  }
  if (!line) return undefined;

  const anchoredAtRoot = line.startsWith('/');
  if (line.startsWith('/')) line = line.slice(1); // /patrón → anclado a la raíz
  let dirOnly = false;
  if (line.endsWith('/')) {
    dirOnly = true;
    line = line.slice(0, -1);
  }
  if (!line) return undefined;

  return { pattern: line, negated, anchored: anchoredAtRoot || line.includes('/'), dirOnly };
}

export function parseGitignore(content: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of content.split('\n')) {
    const rule = parseGitignoreLine(rawLine);
    if (rule) rules.push(rule);
  }

  Object.defineProperty(rules, MATCHER_KEY, { value: ignore().add(content) });
  return rules;
}

function matcherOf(rules: GitignoreRule[]): ignore.Ignore | undefined {
  return (rules as GitignoreRules).__gitignoreMatcher;
}

export function isIgnoredByRules(relPath: string, rules: GitignoreRule[]): boolean {
  if (rules.length === 0) return false;
  const matcher = matcherOf(rules);
  if (matcher === undefined) return false;
  return matcher.ignores(relPath.replace(/^\.\//, ''));
}

export async function loadGitignoreRules(cwd: string): Promise<GitignoreRule[]> {
  const file = Bun.file(join(cwd, '.gitignore'));
  if (!(await file.exists())) return [];
  try {
    return parseGitignore(await file.text());
  } catch {
    return [];
  }
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);

export function isInsideIgnoredDir(relPath: string): boolean {
  return relPath.split('/').some((segment) => IGNORED_DIRS.has(segment));
}

export async function listMarkdownDocuments(cwd: string): Promise<string[]> {
  const entries: string[] = [];
  const gitignoreRules = await loadGitignoreRules(cwd);
  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    if (isInsideIgnoredDir(entry)) continue;
    if (isIgnoredByRules(entry, gitignoreRules)) continue;
    entries.push(entry);
  }
  entries.sort();
  return entries;
}
