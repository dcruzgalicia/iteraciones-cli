export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface FrontmatterLink {
  label: string;
  url: string;
}

export interface FrontmatterSpeaker {
  title: string;
  href?: string;
  body?: string;
}

export interface CollectionPartItem {
  title: string;
  items: CollectionItem[];
}

export type CollectionItem = string | { file: string; part?: boolean } | CollectionPartItem;

export interface FrontmatterFilters {
  type?: string[];
  keywords?: string[];
  author?: string[];
}

export interface Frontmatter {
  title: string;
  date: string;
  author: string[];
  speakers: Array<string | FrontmatterSpeaker>;
  type: string;
  keywords: string[];
  region: string;
  block: boolean;
  draft: boolean;
  items: CollectionItem[];
  filters?: FrontmatterFilters;
  limit?: number;
  abstract?: string;
  tagline?: string;
  location?: string;
  email?: string;
  links?: FrontmatterLink[];
  skills?: string[];
  training?: string[];
  interests?: string[];
  languages?: string[];
  [key: string]: unknown;
}

/**
 * Normaliza un valor desconocido a un array de strings no vacíos con trim.
 * Acepta string (devuelve array de un elemento), string[] (filtra vacíos),
 * o cualquier otro valor (devuelve []).
 */
export function normalizeStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeSpeaker(value: unknown): string | FrontmatterSpeaker | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
    const speakerObject = value as Record<string, unknown>;
    const title = typeof speakerObject.title === 'string' ? speakerObject.title.trim() : '';
    if (!title) return undefined;

    const href = typeof speakerObject.href === 'string' ? speakerObject.href.trim() : undefined;
    const body = typeof speakerObject.body === 'string' ? speakerObject.body.trim() : undefined;

    return {
      title,
      ...(href ? { href } : {}),
      ...(body ? { body } : {}),
    };
  }

  return undefined;
}

function normalizeSpeakers(value: unknown): Array<string | FrontmatterSpeaker> {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSpeaker).filter((item): item is string | FrontmatterSpeaker => item !== undefined);
  }
  return [];
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
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.getPrototypeOf(parsed) === Object.prototype) {
      data = parsed as Record<string, unknown>;
    } else {
      return { frontmatter: emptyFrontmatter(), body: raw };
    }
  } catch {
    return { frontmatter: emptyFrontmatter(), body: raw };
  }

  const body = raw.slice(match[0].length);

  return { frontmatter: normalizeFrontmatter(data), body };
}

function emptyFrontmatter(): Frontmatter {
  return {
    title: '',
    date: '',
    author: [],
    speakers: [],
    type: '',
    keywords: [],
    region: '',
    block: false,
    draft: false,
    items: [],
    filters: undefined,
    limit: undefined,
    abstract: undefined,
    tagline: undefined,
    location: undefined,
    email: undefined,
    links: undefined,
    skills: undefined,
    training: undefined,
    interests: undefined,
    languages: undefined,
  };
}

const ALLOWED_URL_SCHEMES = ['http:', 'https:'];

function isSafeUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    const { protocol } = new URL(url);
    return ALLOWED_URL_SCHEMES.includes(protocol);
  } catch {
    return false;
  }
}

function isSafeEmail(email: string): boolean {
  return /^[^\s"'<>&]+@[^\s"'<>&]+\.[^\s"'<>&]+$/.test(email);
}

function normalizeLink(value: unknown): FrontmatterLink | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const label = typeof obj.label === 'string' ? obj.label.trim() : '';
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  if (!label || !url) return undefined;
  if (!isSafeUrl(url)) return undefined;
  return { label, url };
}

function normalizeLinks(value: unknown): FrontmatterLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map(normalizeLink).filter((item): item is FrontmatterLink => item !== undefined);
  return result.length > 0 ? result : undefined;
}

function normalizeCollectionItems(value: unknown): CollectionItem[] {
  if (!Array.isArray(value)) return [];
  const result: CollectionItem[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) result.push(trimmed);
    } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.title === 'string' && Array.isArray(obj.items)) {
        const title = obj.title.trim();
        const subItems = normalizeCollectionItems(obj.items);
        if (title && subItems.length > 0) {
          result.push({ title, items: subItems });
        }
      } else if (typeof obj.file === 'string') {
        const file = obj.file.trim();
        if (file) {
          result.push({ file, part: obj.part === true });
        }
      }
    }
  }
  return result;
}

function normalizeFilters(value: unknown): FrontmatterFilters | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const f = value as Record<string, unknown>;
  const type = normalizeStringList(f.type);
  const keywords = normalizeStringList(f.keywords);
  const author = normalizeStringList(f.author);
  if (type.length === 0 && keywords.length === 0 && author.length === 0) return undefined;
  return {
    ...(type.length > 0 && { type }),
    ...(keywords.length > 0 && { keywords }),
    ...(author.length > 0 && { author }),
  };
}

function normalizeFrontmatter(data: Record<string, unknown>): Frontmatter {
  return {
    ...data,
    title: typeof data.title === 'string' ? data.title : '',
    date: typeof data.date === 'string' ? data.date : data.date instanceof Date ? data.date.toISOString().slice(0, 10) : '',
    author: normalizeStringList(data.author),
    speakers: normalizeSpeakers(data.speakers),
    type: typeof data.type === 'string' ? data.type : '',
    keywords: Array.isArray(data.keywords) ? data.keywords.filter((k): k is string => typeof k === 'string') : [],
    region: typeof data.region === 'string' ? data.region : '',
    block: data.block === true,
    draft: data.draft === true,
    items: normalizeCollectionItems(data.items),
    filters: normalizeFilters(data.filters),
    limit: typeof data.limit === 'number' && Number.isFinite(data.limit) && data.limit > 0 ? Math.floor(data.limit) : undefined,
    abstract: typeof data.abstract === 'string' && data.abstract.trim() ? data.abstract.trim() : undefined,
    tagline: typeof data.tagline === 'string' && data.tagline.trim() ? data.tagline.trim() : undefined,
    location: typeof data.location === 'string' && data.location.trim() ? data.location.trim() : undefined,
    email: (() => {
      const v = typeof data.email === 'string' ? data.email.trim() : undefined;
      return v && isSafeEmail(v) ? v : undefined;
    })(),
    links: normalizeLinks(data.links),
    skills: (() => {
      const arr = normalizeStringList(data.skills);
      return arr.length > 0 ? arr : undefined;
    })(),
    training: (() => {
      const arr = normalizeStringList(data.training);
      return arr.length > 0 ? arr : undefined;
    })(),
    interests: (() => {
      const arr = normalizeStringList(data.interests);
      return arr.length > 0 ? arr : undefined;
    })(),
    languages: (() => {
      const arr = normalizeStringList(data.languages);
      return arr.length > 0 ? arr : undefined;
    })(),
  };
}
