import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_BLOCKS, type HtmlBlockKey } from '../config/site-config.js';

const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

export function slot(nombre: string): string {
  return `<div id="slot-${nombre}"></div>`;
}

export type HtmlDocType = 'file' | 'collection' | 'creator';

export function htmlCardsDir(type: HtmlDocType): string {
  return join(HTML_RESOURCES_DIR, type);
}

export function htmlMetadataCardPath(type: HtmlDocType): string {
  return join(htmlCardsDir(type), 'card-metadata.html');
}

const HTML_CARDS: Record<HtmlBlockKey, string> = {
  header: 'card-identity.html',
  contenido: 'card-contenido.html',
  formatos: 'card-formatos.html',
  indice: 'card-indice.html',
  referencias: 'card-referencias.html',
  footer: 'card-identity-footer.html',
};

export async function composeHtmlTemplate(siteConfig: SiteConfig, logoInline?: string, type: HtmlDocType = 'file'): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const cardsDir = htmlCardsDir(type);
  const order = siteConfig.format?.html?.blocks ?? [...DEFAULT_HTML_BLOCKS];
  const cards: string[] = [];
  let header = '';
  let metadata = '';
  let footer = '';
  for (const key of order) {
    const card = await Bun.file(join(cardsDir, HTML_CARDS[key])).text();
    if (key === 'header') header = card;
    else if (key === 'footer') footer = card;
    else cards.push(card);
    if (key === 'contenido') metadata = await Bun.file(htmlMetadataCardPath(type)).text();
  }
  const logoBlock = logoInline
    ? `<span class="flex h-10 w-10 shrink-0 items-center justify-center text-accent-500 logo-fill">${logoInline}</span>`
    : '';
  return skeleton
    .replace(slot('header'), () => header)
    .replace(slot('metadata'), () => metadata)
    .replace(slot('footer'), () => footer)
    .replace(slot('cards'), () => cards.join('\n'))
    .split('$logo-block$')
    .join(logoBlock);
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
  docTitle?: string;
  subtitle?: string;
  date?: string;
  homeHref?: string;
  formats?: FormatsLink[];

  titlehead?: string;
  subject?: string;
  publishers?: string;
  collectionCreatorPrefix?: string;

  docChip?: string;

  authors?: string[];
  collectionCreator?: string[];
}

type ExportFormatKey = 'pdf' | 'epub' | 'latex' | 'markdown';

export interface FormatsLink {
  href: string;
  key: ExportFormatKey;
  name: string;
  description: string;
}

export function buildFormatsFlag(formats: FormatsLink[]): string | undefined {
  return formats.length > 0 ? '1' : undefined;
}

export function buildFormatsArgs(formats: FormatsLink[]): string[] {
  return formats.map((f) => `--variable=fmt-${f.key}:${f.href}`);
}
