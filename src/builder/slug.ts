import { basename, dirname } from 'node:path';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function computeSlug(frontmatter: { title?: string; author?: string[]; relativePath?: string }): string | undefined {
  const title = frontmatter.title;
  if (title) {
    const titleSlug = slugify(title);
    const author = frontmatter.author;
    if (author && author.length > 0 && author[0]) {
      return `${slugify(author[0])}-${titleSlug}`;
    }
    return titleSlug;
  }
  return undefined;
}

export function docHtmlPath(doc: { slug?: string; relativePath: string }): string {
  const dir = dirname(doc.relativePath);
  const base = doc.slug ?? basename(doc.relativePath, '.md');
  return dir === '.' ? `${base}.html` : `${dir}/${base}.html`;
}

export function docHref(doc: { slug?: string; relativePath: string }): string {
  return `/${docHtmlPath(doc)}`;
}
