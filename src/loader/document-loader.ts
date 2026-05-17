import { join } from 'node:path';
import type { SourceDocument } from '../builder/types.js';
import { IGNORED_DIRS } from '../constants.js';
import { parseFrontmatter } from './frontmatter.js';

export type { SourceDocument } from '../builder/types.js';

export async function loadDocuments(cwd: string): Promise<SourceDocument[]> {
  const relativePaths: string[] = [];

  for await (const rel of new Bun.Glob('**/*.md').scan({ cwd })) {
    const topSegment = rel.split('/')[0];
    if (topSegment && IGNORED_DIRS.has(topSegment)) continue;
    relativePaths.push(rel);
  }

  relativePaths.sort();

  return Promise.all(
    relativePaths.map(async (relativePath) => {
      const filePath = join(cwd, relativePath);
      const file = Bun.file(filePath);

      let raw: string;
      let stat: Awaited<ReturnType<typeof file.stat>>;
      try {
        [raw, stat] = await Promise.all([file.text(), file.stat()]);
      } catch (err) {
        throw new Error(`Error al leer "${relativePath}": ${String(err)}`, { cause: err });
      }

      const { frontmatter, body } = parseFrontmatter(raw);

      const hasher = new Bun.CryptoHasher('sha256');
      hasher.update(raw);
      const sourceHash = hasher.digest('hex');

      return { filePath, relativePath, frontmatter, body, sourceHash, mtimeMs: stat.mtime.getTime() };
    }),
  );
}
