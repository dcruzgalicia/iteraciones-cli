import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { isDir, relativeLabel } from '../lib/paths.js';
import { DIST_FILES_DIR } from './output-layout.js';

export type AccessibilityIssueKind = 'image-alt' | 'empty-link' | 'image-dimensions' | 'heading-order';

export interface AccessibilityIssue {
  file: string;
  kind: AccessibilityIssueKind;
  message: string;
}

export interface AccessibilityReport {
  checked: number;
  issues: AccessibilityIssue[];
}

interface LocatedIssue extends AccessibilityIssue {
  position: number;
}

function attributePattern(name: string): RegExp {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|/?>)`, 'i');
}

function hasAttribute(tag: string, name: string): boolean {
  return attributePattern(name).test(tag);
}

function attributeValue(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\x60]+))`, 'i').exec(tag);
  if (match === null) return undefined;
  return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

function hasNameAttribute(tag: string): boolean {
  return (attributeValue(tag, 'aria-label') ?? '') !== '' || (attributeValue(tag, 'title') ?? '') !== '';
}

function hasDimensions(tag: string): boolean {
  if (hasAttribute(tag, 'width') && hasAttribute(tag, 'height')) return true;
  const style = attributeValue(tag, 'style') ?? '';
  return /(?:^|;)\s*width\s*:/i.test(style) && /(?:^|;)\s*height\s*:/i.test(style);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\u200b\u200c\u200d]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function linkHasAccessibleName(tag: string, inner: string): boolean {
  if (hasNameAttribute(tag)) return true;
  if (stripTags(inner) !== '') return true;
  for (const image of inner.match(/<img\b[^>]*>/gi) ?? []) {
    if ((attributeValue(image, 'alt') ?? '') !== '') return true;
  }
  for (const title of inner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/gi) ?? []) {
    if (stripTags(title) !== '') return true;
  }
  return false;
}

function imageLabel(tag: string): string {
  return attributeValue(tag, 'src') || '(sin src)';
}

function addIssue(issues: LocatedIssue[], file: string, kind: AccessibilityIssueKind, message: string, position: number): void {
  issues.push({ file, kind, message, position });
}

function auditImages(html: string, file: string, issues: LocatedIssue[]): void {
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const position = match.index ?? 0;
    if (!hasAttribute(tag, 'alt')) {
      addIssue(issues, file, 'image-alt', `imagen sin alt: "${imageLabel(tag)}"`, position);
    }
    if (!hasDimensions(tag)) {
      addIssue(issues, file, 'image-dimensions', `imagen sin width/height: "${imageLabel(tag)}"`, position);
    }
  }
}

function auditLinks(html: string, file: string, issues: LocatedIssue[]): void {
  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tag = match[0].slice(0, match[0].indexOf('>') + 1);
    if (!hasAttribute(tag, 'href') || linkHasAccessibleName(tag, match[1] ?? '')) continue;
    addIssue(issues, file, 'empty-link', `enlace sin nombre accesible: href="${attributeValue(tag, 'href') ?? ''}"`, match.index ?? 0);
  }
}

function auditHeadings(html: string, file: string, issues: LocatedIssue[]): void {
  let previousLevel = 0;
  for (const match of html.matchAll(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi)) {
    const level = Number(match[1]);
    if (previousLevel === 0 && level > 1) {
      addIssue(issues, file, 'heading-order', `el primer encabezado es h${level}; debería ser h1`, match.index ?? 0);
    } else if (previousLevel > 0 && level > previousLevel + 1) {
      addIssue(issues, file, 'heading-order', `salto de encabezado: h${level} después de h${previousLevel}`, match.index ?? 0);
    }
    previousLevel = level;
  }
}

export function auditHtml(html: string, file: string): AccessibilityIssue[] {
  const limpio = html.replace(/<!--[\s\S]*?-->/g, '');
  const issues: LocatedIssue[] = [];
  auditImages(limpio, file, issues);
  auditLinks(limpio, file, issues);
  auditHeadings(limpio, file, issues);
  return issues.sort((a, b) => a.position - b.position).map(({ position: _position, ...issue }) => issue);
}

export async function auditProjectHtml(cwd: string, outputDir?: string): Promise<AccessibilityReport> {
  const dir = outputDir ?? join(cwd, DIST_FILES_DIR);
  if (!(await isDir(dir))) return { checked: 0, issues: [] };

  const files = [...new Bun.Glob('**/*.html').scanSync({ cwd: dir, onlyFiles: true })].sort();
  const root = await realpath(cwd).catch(() => cwd);
  const realDir = await realpath(dir).catch(() => dir);
  const issues: AccessibilityIssue[] = [];
  for (const rel of files) {
    const html = await Bun.file(join(dir, rel)).text();
    issues.push(...auditHtml(html, relativeLabel(root, join(realDir, rel))));
  }
  return { checked: files.length, issues };
}
