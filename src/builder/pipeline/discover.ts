import { stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { parseFrontmatter } from '../../loader/frontmatter.js';
import type { SourceDocument } from '../types.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);

function isIgnored(relativePath: string): boolean {
  const first = relativePath.split('/')[0];
  return first !== undefined && IGNORED_DIRS.has(first);
}

export async function discover(cwd: string): Promise<SourceDocument[]> {
  const glob = new Bun.Glob('**/*.md');
  const results: SourceDocument[] = [];

  for await (const entry of glob.scan(cwd)) {
    if (isIgnored(entry)) continue;

    const filePath = `${cwd}/${entry}`;
    const raw = await Bun.file(filePath).text();
    const { frontmatter, body } = parseFrontmatter(raw);

    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(raw);
    const sourceHash = hasher.digest('hex');

    const { mtimeMs } = await stat(filePath);

    results.push({
      filePath,
      relativePath: relative(cwd, filePath),
      frontmatter,
      body,
      sourceHash,
      mtimeMs,
    });
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
