import { slugBase } from './discover.js';
import { KEYWORDS_DIR } from './output-layout.js';
import { relativeHref } from './pipeline-io.js';
import type { DiscoveryEntry } from './types.js';

export interface KeywordList {
  slug: string;
  label: string;
}

export function keywordsFromFm(fm: Record<string, unknown> | undefined): string[] {
  const raw = fm?.keywords;
  const lista = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  return lista
    .filter((k): k is string => typeof k === 'string')
    .map((k) => k.trim())
    .filter((k) => k !== '');
}

export function keywordsOf(entry: DiscoveryEntry | undefined): string[] {
  return keywordsFromFm(entry?.fm);
}

export function keywordSlug(keyword: string): string | undefined {
  const limpio = slugBase(keyword);
  return limpio === '' ? undefined : limpio;
}

export function keywordListsOf(discoveryIndex: Map<string, DiscoveryEntry>): KeywordList[] {
  const porSlug = new Map<string, string>();
  for (const entry of discoveryIndex.values()) {
    for (const keyword of keywordsOf(entry)) {
      const slug = keywordSlug(keyword);
      if (slug === undefined) continue;
      const actual = porSlug.get(slug);
      if (actual === undefined || keyword.localeCompare(actual, 'es') < 0) porSlug.set(slug, keyword);
    }
  }
  return [...porSlug].map(([slug, label]) => ({ slug, label })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function keywordMembers(discoveryIndex: Map<string, DiscoveryEntry>, slug: string): string[] {
  const miembros: string[] = [];
  for (const [ruta, entry] of discoveryIndex) {
    if (entry.type === 'intervention') continue;
    if (keywordsOf(entry).some((keyword) => keywordSlug(keyword) === slug)) miembros.push(ruta);
  }
  return miembros;
}

export function keywordHref(dir: string, slug: string): string {
  if (dir === KEYWORDS_DIR) return `./${slug}.html`;
  return relativeHref(dir, `${KEYWORDS_DIR}/${slug}.html`);
}
