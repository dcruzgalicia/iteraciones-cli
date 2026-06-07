import { escapeHtml } from './html.js';

interface TocEntry {
  level: number;
  id: string;
  text: string;
}

const HEADING_RE = /<h([1-6])\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/gi;

const TAG_RE = /<[^>]*>/g;

function stripTags(html: string): string {
  return html.replace(TAG_RE, '').trim();
}

function parseHeadings(html: string, maxDepth: number): TocEntry[] {
  const entries: TocEntry[] = [];
  let match: RegExpExecArray | null = HEADING_RE.exec(html);
  while (match !== null) {
    const level = Number.parseInt(match[1] ?? '0', 10);
    if (level > maxDepth) {
      match = HEADING_RE.exec(html);
      continue;
    }
    const id = match[2] ?? '';
    const rawText = match[3] ?? '';
    const text = stripTags(rawText);
    if (id && text) {
      entries.push({ level, id, text });
    }
    match = HEADING_RE.exec(html);
  }
  return entries;
}

export function buildTocHtml(htmlFragment: string, maxDepth: number): string {
  const entries = parseHeadings(htmlFragment, maxDepth);
  if (entries.length === 0) return '';

  const lines: string[] = ['<ul>'];
  const stack: number[] = [(entries[0] as TocEntry).level];
  let hasItems = false;

  for (const entry of entries) {
    const level = entry.level;

    while (stack.length > 0) {
      const last = stack[stack.length - 1];
      if (last === undefined || last <= level) break;
      lines.push('</li></ul>');
      stack.pop();
    }

    if (hasItems && stack.length > 0) {
      const last = stack[stack.length - 1];
      if (last !== undefined && last === level) {
        lines.push('</li>');
      }
    }

    if (stack.length === 0) {
      lines.push('<ul>');
      stack.push(level);
    } else {
      const last = stack[stack.length - 1];
      if (last !== undefined && last < level) {
        lines.push('<ul>');
        stack.push(level);
      }
    }

    lines.push(`<li><a href="#${entry.id}">${escapeHtml(entry.text)}</a>`);
    hasItems = true;
  }

  while (stack.length > 0) {
    lines.push('</li></ul>');
    stack.pop();
  }

  const innerHtml = lines.join('');
  return `<nav class="toc" role="navigation" aria-label="Table of contents">\n<h2 class="toc-title">Contenido</h2>\n${innerHtml}\n</nav>`;
}
