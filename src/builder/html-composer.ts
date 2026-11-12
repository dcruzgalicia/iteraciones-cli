import { join } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { DEFAULT_HTML_FORMAT } from '../config/site-config.js';

export const HTML_RESOURCES_DIR = join(import.meta.dir, '../lib/resources/html');

export function slot(nombre: string): string {
  return `<div id="slot-${nombre}"></div>`;
}

export type HtmlDocType = 'file' | 'collection' | 'creator' | 'list' | 'menu' | 'announcement';

const CARD_DIRS: Record<HtmlDocType, string> = {
  file: 'file',
  collection: 'collection',
  creator: 'file',
  list: 'collection',
  menu: 'file',
  announcement: 'file',
};

export async function loadCard(type: HtmlDocType, name: string): Promise<string> {
  const own = Bun.file(join(HTML_RESOURCES_DIR, CARD_DIRS[type], name));
  return (await own.exists()) ? own.text() : Bun.file(join(HTML_RESOURCES_DIR, 'file', name)).text();
}

const IDENTITY_APERTURA = '    <div id="card-identity" class="min-w-0">\n\n';
const FOOTER_APERTURA = '    <div id="card-identity-footer" class="min-w-0">\n';

function comoFooter(card: string): string {
  return card.replace(IDENTITY_APERTURA, FOOTER_APERTURA);
}

export function htmlResourceFiles(): string[] {
  return [...new Bun.Glob('**/*.html').scanSync({ cwd: HTML_RESOURCES_DIR, onlyFiles: true })].sort();
}

function logoSizeCss(value: string | undefined): string {
  const limpio = (value ?? '').trim();
  return /^\d+(\.\d+)?(px|rem|em|vw|vh|%)$/.test(limpio) ? limpio : DEFAULT_HTML_FORMAT.site.logoSize;
}

function logoIntrinsicSize(logoSize?: string): number {
  const px = Number.parseFloat(logoSizeCss(logoSize));
  return Number.isNaN(px) ? 100 : Math.round(px * 2);
}

export function logoBlockHtml(href: string, logoSize?: string, svg?: string): string {
  const size = logoIntrinsicSize(logoSize);
  const inner = svg ?? `<img src="${href}" alt="" width="${size}" height="${size}" class="block h-auto w-full">`;
  return `<span class="flex shrink-0 text-accent-500 logo-fill" style="width:${logoSizeCss(logoSize)}">${inner}</span>`;
}

export function creatorPortraitHtml(image: string, alt: string): string {
  return `<figure class="relative m-0 h-[30rem] sm:h-auto md:h-[30rem] lg:h-auto"><img src="${Bun.escapeHTML(image)}" alt="${Bun.escapeHTML(alt)}" class="absolute inset-0 block h-full w-full object-cover object-center"></figure>`;
}

export const CHIP_OUTLINE_CLASSES =
  'not-prose inline-flex h-6 sm:h-7 lg:h-8 items-center rounded-md border-2 border-accent-500/40 bg-transparent px-2 sm:px-2.5 lg:px-3 text-[10px] sm:text-[11px] lg:text-xs font-normal uppercase tracking-wide leading-none no-underline text-accent-700 transition-all duration-200 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0] hover:shadow-accent-500/30 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-accent-400/40 dark:text-accent-300';

function frecuenciasInline(siteConfig: SiteConfig): string {
  const links = siteConfig.format?.html?.site?.links ?? [];
  if (links.length === 0) return '';
  const items = links
    .map(
      (link: { name: string; url: string }) =>
        `<a href="${Bun.escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex h-6 sm:h-7 lg:h-8 items-center rounded-md border-2 border-stone-500/60 bg-transparent px-2 sm:px-2.5 lg:px-3 text-[10px] sm:text-[11px] lg:text-xs font-semibold text-stone-600 no-underline transition-all duration-200 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-stone-600 hover:bg-stone-500/10 hover:shadow-[3px_3px_0_0] hover:shadow-stone-500/25 sm:px-3 sm:text-xs lg:px-3.5 lg:text-sm dark:border-stone-400/60 dark:bg-transparent dark:text-stone-300 dark:hover:bg-stone-500/10">${Bun.escapeHTML(link.name)}</a>`,
    )
    .join('');
  return `<nav aria-label="Redes" class="contents">${items}</nav>`;
}

function identityCard(children: string[]): string {
  return [
    '<div class="tarjeta relative rounded-lg p-4 sm:p-6 lg:p-8">',
    '<div class="grid gap-8 sm:grid-cols-2 sm:gap-10 lg:gap-12">',
    ...children,
    '</div>',
    '</div>',
  ].join('\n');
}

function headerHtml(identity: string, menuHeader: string, redes: string): string {
  return identityCard([
    `<div class="min-w-0">${identity}</div>`,
    `<div class="flex flex-wrap items-start justify-start gap-2 sm:justify-end">${menuHeader}${redes}</div>`,
  ]);
}

function footerHtml(footerIdentity: string, menuFooterPlain: string, redes: string): string {
  return identityCard([
    `<div class="flex flex-wrap items-start justify-start gap-2">${menuFooterPlain}${redes}</div>`,
    `<div class="flex min-w-0 items-center justify-start">${footerIdentity}</div>`,
  ]);
}

function fillSlot(html: string, name: string, content: string): string {
  const start = html.indexOf(`<div id="slot-${name}"`);
  if (start === -1) return html;
  const openEnd = html.indexOf('>', start);
  if (openEnd === -1) return html;
  const close = html.indexOf('</div>', openEnd);
  if (close === -1) return html;
  return html.slice(0, openEnd + 1) + content + html.slice(close);
}

export async function composeHtmlTemplate(siteConfig: SiteConfig, type: HtmlDocType = 'file'): Promise<string> {
  const skeleton = await Bun.file(join(HTML_RESOURCES_DIR, 'skeleton.html')).text();
  const identity = await loadCard(type, 'card-identity.html');
  const footerIdentity = comoFooter(await loadCard(type, 'card-identity.html'));
  const metadata = await loadCard(type, 'card-metadata.html');
  const referencias = await loadCard(type, 'card-referencias.html');
  const contenido = await loadCard(type, 'card-contenido.html');
  const relatedCards = [
    '$if(sidebar-extras)$$sidebar-extras$$endif$',
    await loadCard(type, 'card-indice.html'),
    await loadCard(type, 'card-formatos.html'),
    await loadCard('file', 'card-cita.html'),
    await loadCard('file', 'card-indice-coleccion.html'),
  ];
  const siteCards = ['$if(recientes)$$recientes$$endif$', '$if(site-keywords)$$site-keywords$$endif$', await loadCard('file', 'card-licencia.html')];

  const redes = frecuenciasInline(siteConfig);
  const menuHeader = '$if(menu-header)$$menu-header$$endif$';
  const menuFooterPlain = '$if(menu-footer-plain)$$menu-footer-plain$$endif$';
  const header = headerHtml(identity, menuHeader, redes);
  const contraportada = await loadCard('file', 'card-contraportada.html');
  const esCreador = type === 'creator';
  const pageType = esCreador ? 'creator' : type === 'collection' || type === 'list' ? 'collection' : 'file';
  const main = esCreador ? contenido : [contenido, '$if(extras)$$extras$$endif$', '$if(pagination)$$pagination$$endif$'].join('\n');
  const publications = esCreador ? ['$if(extras)$$extras$$endif$', '$if(pagination)$$pagination$$endif$'].join('\n') : '';
  const related = [contraportada, ...relatedCards, referencias].join('\n');
  const sidebar = ['$if(announcements-top)$$announcements-top$$endif$', ...siteCards, '$if(announcements-bottom)$$announcements-bottom$$endif$'].join(
    '\n',
  );
  const footer = footerHtml(footerIdentity, menuFooterPlain, redes);

  let html = skeleton
    .replace('$page-type-class$', `page-${pageType}`)
    .replace(slot('header'), () => header)
    .replace(slot('footer'), () => footer);
  html = fillSlot(html, 'page-header', metadata);
  html = fillSlot(html, 'main', main);
  html = fillSlot(html, 'publications', publications);
  html = fillSlot(html, 'related', related);
  html = fillSlot(html, 'sidebar', sidebar);
  return html;
}

export interface HtmlPageVars {
  title: string;
  siteTitle: string;
  tagline?: string;
  metaDescription?: string;
  canonical?: string;
  socialMeta?: string;
  jsonLd?: string;
  lang: string;

  logoBlock?: string;

  favicon?: string;

  keywords?: string;
  theme?: string;
  css?: string;
  iconTop?: string;
  authorMeta?: string;
  docTitle?: string;
  subtitle?: string;
  abstract?: string;
  date?: string;
  dateIso?: string;
  showDates?: boolean;
  homeHref?: string;
  formats?: FormatsLink[];

  titlehead?: string;
  subject?: string;
  collectionCreatorPrefix?: string;

  docChip?: string;
  docChipHref?: string;
  contentChip?: string;
  frontCover?: string;
  backCover?: string;
  creatorImage?: string;
  creatorImageAlt?: string;
  creatorPhoto?: string;
  license?: string;
  menuHeader?: string;
  menuFooterPlain?: string;

  collectionChips?: string;
  keywordChips?: string;
  announcementsTop?: string;
  announcementsBottom?: string;
  indiceColeccion?: string;
  publicationMeta?: string;
  citationBlock?: string;

  extras?: string;

  sidebarExtras?: string;

  recientes?: string;

  siteKeywords?: string;

  pagination?: string;

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

export function buildFormatsArgs(formats: FormatsLink[]): string[] {
  return formats.map((f) => `--variable=fmt-${f.key}:${f.href}`);
}
