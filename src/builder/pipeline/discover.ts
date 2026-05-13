import { join } from 'node:path';
import { parseFrontmatter } from '../../loader/frontmatter.js';
import type { SourceDocument } from '../types.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);

export async function discover(cwd: string): Promise<SourceDocument[]> {
  const relativePaths: string[] = [];

  for await (const entry of new Bun.Glob('**/*.md').scan({ cwd })) {
    const first = entry.split('/')[0];
    if (first && IGNORED_DIRS.has(first)) continue;
    relativePaths.push(entry);
  }

  relativePaths.sort();

  return Promise.all(
    relativePaths.map(async (relativePath) => {
      const filePath = join(cwd, relativePath);
      const file = Bun.file(filePath);

      let raw: string;
      let fileStat: Awaited<ReturnType<typeof file.stat>>;
      try {
        [raw, fileStat] = await Promise.all([file.text(), file.stat()]);
      } catch (err) {
        throw new Error(`Error al leer "${relativePath}": ${String(err)}`, { cause: err });
      }

      const { frontmatter, body } = parseFrontmatter(raw);

      const hasher = new Bun.CryptoHasher('sha256');
      hasher.update(raw);
      const sourceHash = hasher.digest('hex');

      return { filePath, relativePath, frontmatter, body, sourceHash, mtimeMs: fileStat.mtime.getTime() };
    }),
  );
}
