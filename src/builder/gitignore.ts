import { join } from 'node:path';
import ignore from 'ignore';

export function parseGitignore(content: string): ignore.Ignore {
  return ignore().add(content);
}

export function isIgnoredByRules(relPath: string, matcher: ignore.Ignore): boolean {
  return matcher.ignores(relPath.replace(/^\.\//, ''));
}

export async function loadGitignoreRules(cwd: string): Promise<ignore.Ignore> {
  const file = Bun.file(join(cwd, '.gitignore'));
  if (!(await file.exists())) return ignore();
  try {
    return parseGitignore(await file.text());
  } catch {
    return ignore();
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
