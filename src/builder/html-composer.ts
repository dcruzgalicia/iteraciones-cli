import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_BLOCKS, type HtmlBlockKey } from '../config/site-config.js';

const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

const HTML_CARDS: Record<HtmlBlockKey, string> = {
  header: 'card-identity.html',
  contenido: 'card-contenido.html',
  formatos: 'card-formatos.html',
  indice: 'card-indice.html',
  referencias: 'card-referencias.html',
  footer: 'card-identity-footer.html',
};

export async function composeHtmlTemplate(siteConfig: SiteConfig): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const order = siteConfig.format?.html?.blocks ?? [...DEFAULT_HTML_BLOCKS];
  const blocks: string[] = [];
  for (const key of order) {
    const card = await Bun.file(join(HTML_RESOURCES_DIR, HTML_CARDS[key])).text();
    blocks.push(card);
  }
  return skeleton.replace('<!-- cards -->', blocks.join('\n'));
}

export interface HtmlPageVars {
  title: string;
  siteTitle: string;
  tagline?: string;
  lang: string;
  theme?: string;
  accent?: string;
  css?: string;
  authorMeta?: string;
  logoInline?: string;
  docTitle?: string;
  subtitle?: string;
  date?: string;
  homeHref?: string;
  formats?: FormatsLink[];
}

type ExportFormatKey = 'pdf' | 'epub' | 'latex' | 'markdown';

export interface FormatsLink {
  href: string;
  key: ExportFormatKey;
  name: string;
  description: string;
}

const FORMAT_ICONS: Record<ExportFormatKey, string> = {
  pdf: '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h4M10 15h4"/></svg>',
  epub: '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z"/><path d="M12 6v14"/></svg>',
  latex:
    '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14"/><path d="M5 4l1.5 2M19 4l-1.5 2"/><path d="M12 4v16"/><path d="M8.5 20h7"/></svg>',
  markdown:
    '<svg class="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14M5 10h10M5 14h14M5 18h8"/></svg>',
};

export function buildFormatsItems(formats: FormatsLink[]): string | undefined {
  if (formats.length === 0) return undefined;

  return formats
    .map(
      (f) =>
        `        <li>\n` +
        `          <a href="${f.href}" class="flex items-center gap-3 rounded-lg transition-colors duration-200 hover:bg-accent-500/10">\n` +
        `            <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-accent-500/30 bg-accent-500/10 text-accent-500">${FORMAT_ICONS[f.key]}</span>\n` +
        `            <div class="flex flex-col">\n` +
        `              <span class="text-lg font-semibold text-accent-950 dark:text-accent-50">${f.name}</span>\n` +
        `              <span class="text-sm italic text-accent-600 dark:text-accent-400">${f.description}</span>\n` +
        `            </div>\n` +
        `          </a>\n` +
        `        </li>`,
    )
    .join('\n');
}
