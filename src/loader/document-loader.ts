import { join } from 'node:path';
import { type Frontmatter, parseFrontmatter } from './frontmatter.js';

// stub: SourceDocument se mueve a src/builder/types.ts en el issue #19
export interface SourceDocument {
  filePath: string;
  relativePath: string;
  frontmatter: Frontmatter;
  body: string;
  sourceHash: string;
  mtime: number;
}

export async function loadDocuments(cwd: string): Promise<SourceDocument[]> {
  const relativePaths: string[] = [];

  for await (const rel of new Bun.Glob('**/*.md').scan({ cwd })) {
    relativePaths.push(rel);
  }

  relativePaths.sort();

  return Promise.all(
    relativePaths.map(async (relativePath) => {
      const filePath = join(cwd, relativePath);
      const file = Bun.file(filePath);
      const [raw, stat] = await Promise.all([file.text(), file.stat()]);
      const { frontmatter, body } = parseFrontmatter(raw);

      const hasher = new Bun.CryptoHasher('sha256');
      hasher.update(raw);
      const sourceHash = hasher.digest('hex');

      return { filePath, relativePath, frontmatter, body, sourceHash, mtime: stat.mtime.getTime() };
    }),
  );
}
