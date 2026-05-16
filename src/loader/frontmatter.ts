export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface FrontmatterSpeaker {
  title: string;
  href?: string;
  body?: string;
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
  return { title: '', date: '', author: [], speakers: [], type: '', keywords: [], region: '', block: false };
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
  };
}
