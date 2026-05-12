const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface Frontmatter {
  title: string;
  date: string;
  author: string;
  type: string;
  keywords: string[];
  region: string;
  block: boolean;
  [key: string]: unknown;
}

export interface ParsedFile {
  frontmatter: Frontmatter;
  body: string;
}

export function parseFrontmatter(raw: string): ParsedFile {
  const match = raw.match(FRONTMATTER_RE);

  if (!match) return { frontmatter: emptyFrontmatter(), body: raw };

  let data: Record<string, unknown> = {};
  try {
    const parsed = Bun.YAML.parse(match[1] ?? '');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    return { frontmatter: emptyFrontmatter(), body: raw };
  }

  const body = raw.slice(match[0].length);

  return { frontmatter: normalizeFrontmatter(data), body };
}

function emptyFrontmatter(): Frontmatter {
  return { title: '', date: '', author: '', type: '', keywords: [], region: '', block: false };
}

function normalizeFrontmatter(data: Record<string, unknown>): Frontmatter {
  return {
    title: typeof data.title === 'string' ? data.title : '',
    date: typeof data.date === 'string' ? data.date : data.date instanceof Date ? data.date.toISOString().slice(0, 10) : '',
    author: typeof data.author === 'string' ? data.author : '',
    type: typeof data.type === 'string' ? data.type : '',
    keywords: Array.isArray(data.keywords) ? data.keywords.filter((k): k is string => typeof k === 'string') : [],
    region: typeof data.region === 'string' ? data.region : '',
    block: data.block === true,
  };
}
