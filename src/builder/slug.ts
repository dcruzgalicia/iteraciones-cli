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
