import { join } from 'node:path';
import { logWarning } from '../lib/logger.js';

const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

export function removeTocReferencesLink(html: string): string {
  return html.replace(/<li>\s*<a href="#refs-heading"[^>]*>.*?<\/a>\s*<\/li>/gs, '');
}

export function loadReferencesCardTemplate(): Promise<string> {
  return Bun.file(join(HTML_RESOURCES_DIR, 'card-referencias-block.html')).text();
}

function stripSyntheticReferencesMarker(html: string, refsIdPos: number, start: number): string {
  let cleaned = html;
  if (refsIdPos >= 0 && start >= 0) {
    const headingEnd = cleaned.indexOf('</h', start);
    if (headingEnd >= 0) {
      const tagEnd = cleaned.indexOf('>', headingEnd);
      if (tagEnd >= 0) cleaned = cleaned.slice(0, start) + cleaned.slice(tagEnd + 1);
    }
  }
  return cleaned.replace('<!-- block:referencias -->', '');
}

function findBalancedDivEnd(html: string, divStart: number): number | undefined {
  let depth = 0;
  let i = divStart;
  while (i < html.length) {
    const open = html.indexOf('<div', i);
    const close = html.indexOf('</div>', i);
    if (close < 0) break;
    if (open >= 0 && open < close) {
      depth++;
      i = open + 4;
    } else {
      depth--;
      i = close + 6;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    logWarning(`HTML mal balanceado: las referencias no se extrajeron del documento; revisa los filtros Lua propios (div sin cerrar)`, 'html');
    return undefined;
  }
  return i;
}

export function extractReferencesBlock(html: string, cardTemplate: string): { html: string; block?: string } {
  const refsIdPos = html.indexOf('id="refs-heading"');
  const refsDivPos = html.indexOf('<div id="refs"');
  if (refsIdPos < 0 && refsDivPos < 0) return { html };

  const start = refsIdPos >= 0 ? Math.max(html.lastIndexOf('<h1', refsIdPos), html.lastIndexOf('<h5', refsIdPos)) : refsDivPos;
  const divStart = html.indexOf('<div id="refs"', start);
  if (divStart < 0) {
    if (!html.includes('<!-- block:referencias -->')) return { html };
    return { html: stripSyntheticReferencesMarker(html, refsIdPos, start) };
  }

  const end = findBalancedDivEnd(html, divStart);
  if (end === undefined) return { html };

  const listChunk = html.slice(divStart, end);
  return { html: html.slice(0, start) + html.slice(end), block: cardTemplate.replace('{{refs-list}}', listChunk) };
}
