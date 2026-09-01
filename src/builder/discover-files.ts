import { isIgnoredByRules, isInsideIgnoredDir, loadGitignoreRules } from './gitignore.js';

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
